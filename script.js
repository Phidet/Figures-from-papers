let pdfDoc = null;
let currentPage = 1;
let scale = 1.5; // Adjust for resolution/quality
let scaleDiff = 0; // New global for container width difference
let isDrawing = false;
let isRendering = false;
let startX, startY, endX, endY;
let pdfDocBuffer = null;

// Keep reference to the latest viewport
let currentViewport = null;

const canvas = document.getElementById('pdfCanvas');
const ctx = canvas.getContext('2d');
const offScreenCanvas = document.createElement('canvas');
const offScreenCtx = offScreenCanvas.getContext('2d');

const rects = [];
let draggingCorner = null;
let activeRectIndex = -1;
const cornerSize = 12;
let autoTightenOffset = 2.5; // configurable offset in pixels

const searchBar = document.querySelector('.search-bar');
const customPlaceholder = document.querySelector('.custom-placeholder');

// Hide placeholder on focus or when input has text
searchBar.addEventListener('focus', () => {
    customPlaceholder.style.display = 'none';
});
searchBar.addEventListener('blur', () => {
    if (searchBar.value.trim() === "") {
        customPlaceholder.style.display = 'block';
    }
});
searchBar.addEventListener('input', () => {
    customPlaceholder.style.display = searchBar.value.trim() ? 'none' : 'block';
});

// Also, clicking the placeholder (outside the hyperlink) focuses the input
customPlaceholder.addEventListener('click', (e) => {
    if (e.target.id !== 'uploadFileLink') {
        searchBar.focus();
    }
});

const canvasContainer = document.querySelector('.canvas-container');
const initialContainer = document.querySelector('.initial-container');
const uploadZone = document.getElementById('uploadZone');

const pageNav = document.querySelector('.page-nav');
const currentPageSpan = document.getElementById('currentPage');
const totalPagesSpan = document.getElementById('totalPages');
const pageInput = document.getElementById('pageInput');

// Handler for the upload file link
document.getElementById('uploadFileLink').addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('pdfInput').click();
});

document.getElementById('pdfInput').addEventListener('change', async (e) => {
    if (e.target.files[0]) {
        handlePDFFile(e.target.files[0]);
    }
});

async function handlePDFFile(file) {
    initialContainer.classList.add('pdf-loaded');
    canvasContainer.classList.add('active');
    pageNav.classList.add('active');
    
    const arrayBuffer = await file.arrayBuffer();
    pdfDocBuffer = arrayBuffer.slice(0);
    pdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
    totalPagesSpan.textContent = pdfDoc.numPages;
    currentPage = 1;
    pageInput.value = '1';
    renderPage(currentPage);
}

document.querySelector('.prev').addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        pageInput.value = currentPage;
        renderPage(currentPage);
    }
});

document.querySelector('.next').addEventListener('click', () => {
    if (pdfDoc && currentPage < pdfDoc.numPages) {
        currentPage++;
        pageInput.value = currentPage;
        renderPage(currentPage);
    }
});

document.querySelector('.home').addEventListener('click', () => {
    // Clear everything and show initial container
    initialContainer.classList.remove('pdf-loaded');
    canvasContainer.classList.remove('active');
    pageNav.classList.remove('active');
    pdfDoc = null;
    pdfDocBuffer = null;
    currentPage = 1;
    pageInput.value = '1';
    rects.length = 0;
});

pageInput.addEventListener('change', () => {
    const newPage = parseInt(pageInput.value, 10);
    if (pdfDoc && newPage >= 1 && newPage <= pdfDoc.numPages) {
        currentPage = newPage;
        renderPage(currentPage);
    } else {
        // Reset to current page if invalid
        pageInput.value = currentPage;
    }
});

// Helper to clear crop UI (rectangle and floating button)
function clearCropUI() {
    // Clear existing rectangles and floating download button
    rects.length = 0;
    const existingButton = document.querySelector('.floating-download');
    if (existingButton) { existingButton.remove(); }
    // Also remove floating island container if present
    const existingIsland = document.querySelector('.floating-island');
    if (existingIsland) { existingIsland.remove(); }
}

// Update renderPage to clear cropping UI when switching pages
async function renderPage(pageNum) {
    clearCropUI();
    if (isRendering) return;
    isRendering = true;
  
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    currentViewport = viewport;
  
    // Set canvas size to match viewport exactly
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    offScreenCanvas.width = viewport.width;
    offScreenCanvas.height = viewport.height;
  
    // Set display size to match internal size
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
  
    await page.render({
      canvasContext: offScreenCtx,
      viewport,
    }).promise;
  
    ctx.drawImage(offScreenCanvas, 0, 0);
    pageInput.value = pageNum;
    isRendering = false;
}

canvas.addEventListener('mousedown', (e) => {
    const { offsetX, offsetY } = e;
    // Check corner click
    activeRectIndex = -1;
    draggingCorner = null;
    for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i];
        const corners = [
            { x: r.startX, y: r.startY, name: 'tl' },
            { x: r.endX,   y: r.startY, name: 'tr' },
            { x: r.startX, y: r.endY,   name: 'bl' },
            { x: r.endX,   y: r.endY,   name: 'br' },
        ];
        for (const c of corners) {
            if (isOverCorner(offsetX, offsetY, c.x, c.y)) {
                draggingCorner = c.name;
                activeRectIndex = i;
                isDrawing = false;
                return;
            }
        }
    }
    // If not corner, start new rect and clear existing ones
    isDrawing = true;
    // Remove floating button and island immediately when starting new rectangle
    const existingIsland = document.querySelector('.floating-island');
    if (existingIsland) { existingIsland.remove(); }
    // Delete existing rects
    rects.length = 0;
    drawAllRects();
    rects.push({ startX: offsetX, startY: offsetY, endX: offsetX, endY: offsetY });
    activeRectIndex = 0;
});

canvas.addEventListener('mousemove', (e) => {
  const { offsetX, offsetY } = e;
  // Update cursor based on corner hover
  let isOverAnyCorner = false;
  for (const r of rects) {
    const corners = [
      { x: r.startX, y: r.startY },
      { x: r.endX,   y: r.startY },
      { x: r.startX, y: r.endY   },
      { x: r.endX,   y: r.endY   }
    ];
    if (corners.some(c => isOverCorner(offsetX, offsetY, c.x, c.y))) {
      canvas.style.cursor = 'pointer';
      isOverAnyCorner = true;
      break;
    }
  }
  if (!isOverAnyCorner) {
    canvas.style.cursor = 'crosshair';
  }

  // Rest of mousemove handling
  if (draggingCorner !== null && activeRectIndex >= 0) {
    const rect = rects[activeRectIndex];
    // Reset autoTightened flag when resizing
    rect.autoTightened = false;
    // Update corner
    if (draggingCorner === 'tl') {
      rect.startX = e.offsetX; rect.startY = e.offsetY;
    } else if (draggingCorner === 'tr') {
      rect.endX = e.offsetX; rect.startY = e.offsetY;
    } else if (draggingCorner === 'bl') {
      rect.startX = e.offsetX; rect.endY = e.offsetY;
    } else if (draggingCorner === 'br') {
      rect.endX = e.offsetX; rect.endY = e.offsetY;
    }
    updateFloatingButton(rects[activeRectIndex]);
  } else if (isDrawing && activeRectIndex >= 0) {
    rects[activeRectIndex].endX = e.offsetX;
    rects[activeRectIndex].endY = e.offsetY;
    // Ensure the new rectangle starts without auto-tightening applied
    rects[activeRectIndex].autoTightened = false;
  }
  drawAllRects();
});

canvas.addEventListener('mouseup', () => {
  if (isDrawing && rects[0]) {
    // Only show button for valid rectangle dimensions
    const rect = rects[0];
    if (Math.abs(rect.endX - rect.startX) > 20 && Math.abs(rect.endY - rect.startY) > 20) {
      updateFloatingButton(rect);
    } else {
      // If too small, remove rectangle and any floating button
      rects.length = 0;
      const existingButton = document.querySelector('.floating-download');
      if (existingButton) { existingButton.remove(); }
    }
  }
  isDrawing = false;
  draggingCorner = null;
  activeRectIndex = -1;
});

function drawAllRects() {
  if (isRendering) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(offScreenCanvas, 0, 0);
  
  rects.forEach((r) => {
    // Draw rectangle
    ctx.strokeStyle = 'blue';
    ctx.strokeRect(r.startX, r.startY, r.endX - r.startX, r.endY - r.startY);
    
    // Draw corner circles
    ctx.fillStyle = 'blue';
    const corners = [
      { x: r.startX, y: r.startY },
      { x: r.endX,   y: r.startY },
      { x: r.startX, y: r.endY   },
      { x: r.endX,   y: r.endY   }
    ];
    corners.forEach(c => {
      ctx.beginPath();
      ctx.arc(c.x, c.y, cornerSize/2, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

function isOverCorner(mouseX, mouseY, cornerX, cornerY) {
  return Math.abs(cornerX - mouseX) < cornerSize && 
         Math.abs(cornerY - mouseY) < cornerSize;
}

let currentRotation = 0; // New global rotation state

function updateFloatingButton(rect) {
    // Remove any existing container
    const existingIsland = document.querySelector('.floating-island');
    if (existingIsland) {
        existingIsland.remove();
    }
    if (!rect) return;

    // Create container
    const island = document.createElement('div');
    island.className = 'floating-island';
    
    // Create crop button
    const cropBtn = document.createElement('button');
    cropBtn.style.backgroundImage = "url('cut.svg')";
    cropBtn.title = "Crop and download";
    cropBtn.addEventListener('click', cropPreserved);

    // Create tighten button
    const tightenBtn = document.createElement('button');
    tightenBtn.style.backgroundImage = "url('fullscreen.svg')";
    tightenBtn.title = "Auto-tighten crop";
    tightenBtn.addEventListener('click', () => {
        autoTightenRect(rect);
        drawAllRects();
        updateFloatingButton(rect);
    });

    // Create navigation/rotation button
    const navBtn = document.createElement('button');
    const navIcon = document.createElement('span');
    navIcon.style.backgroundImage = "url('navigation.svg')";
    navIcon.style.backgroundSize = "20px";
    navIcon.style.display = "inline-block";
    navIcon.style.width = "20px";
    navIcon.style.height = "20px";
    navIcon.style.transition = "transform 0.2s ease";
    navIcon.style.transform = `rotate(${currentRotation}deg)`;
    navIcon.style.pointerEvents = "none"; // ensure click passes to parent
    navBtn.title = "Rotate cropping orientation";
    navBtn.addEventListener('click', () => {
        currentRotation += 90; // accumulate rotation
        navIcon.style.transform = `rotate(${currentRotation}deg)`;
    });
    navBtn.appendChild(navIcon);

    island.appendChild(cropBtn);
    island.appendChild(tightenBtn);
    island.appendChild(navBtn);

    // Position the container
    const left = Math.min(rect.startX, rect.endX);
    /* scaleDiff / 2 is the canvas offset on one side and then half of that to center island */
    const centerX = left + Math.abs(rect.startX - rect.endX) / 2 - scaleDiff / 4;
    const top = Math.min(rect.startY, rect.endY)
    island.style.left = `${centerX}px`;
    island.style.top = `${top}px`;
    island.style.transform = 'translateX(50%) translateY(-120%)';

    document.querySelector('.canvas-wrapper').appendChild(island);
}

// Auto-tighten function with offset
function autoTightenRect(rect) {
    // Prevent further auto-tightening if already applied
    if (rect.autoTightened) return;

    const xMin = Math.min(rect.startX, rect.endX);
    const yMin = Math.min(rect.startY, rect.endY);
    const xMax = Math.max(rect.startX, rect.endX);
    const yMax = Math.max(rect.startY, rect.endY);
    const width = xMax - xMin;
    const height = yMax - yMin;
    if (width < 1 || height < 1) return;
    
    // Get image data from offScreenCanvas
    const imageData = offScreenCtx.getImageData(xMin, yMin, width, height).data;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    
    // Simple threshold for non-white detection
    for (let i = 0; i < imageData.length; i += 4) {
        const r = imageData[i], g = imageData[i+1], b = imageData[i+2];
        const alpha = imageData[i+3];
        const pixelIndex = i / 4;
        const px = pixelIndex % width;
        const py = Math.floor(pixelIndex / width);
        if (alpha > 0 && (r < 235 || g < 235 || b < 235)) {
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
        }
    }
    // Only update if a non-white region was found
    if (maxX > 0 || maxY > 0) {
        const candidateStartX = xMin + minX;
        const candidateEndX   = xMin + maxX;
        const candidateStartY = yMin + minY;
        const candidateEndY   = yMin + maxY;

        const newStartX = (candidateStartX > xMin) ? Math.max(xMin, candidateStartX - autoTightenOffset) : candidateStartX;
        const newEndX   = (candidateEndX   < xMax) ? Math.min(xMax, candidateEndX + autoTightenOffset)   : candidateEndX;
        const newStartY = (candidateStartY > yMin) ? Math.max(yMin, candidateStartY - autoTightenOffset) : candidateStartY;
        const newEndY   = (candidateEndY   < yMax) ? Math.min(yMax, candidateEndY + autoTightenOffset)   : candidateEndY;

        rect.startX = newStartX;
        rect.startY = newStartY;
        rect.endX   = newEndX;
        rect.endY   = newEndY;
        rect.autoTightened = true;
    }
}

async function cropPreserved() {
  if (!pdfDocBuffer || !pdfDoc || !currentViewport || rects.length === 0) return;
  const { PDFDocument, PDFName, degrees } = PDFLib;
  
  // Create a new PDF with just the current page
  const newPdf = await PDFDocument.create();
  const sourcePdf = await PDFDocument.load(pdfDocBuffer.slice(0));
  const [copiedPage] = await newPdf.copyPages(sourcePdf, [currentPage - 1]);
  newPdf.addPage(copiedPage);
  
  const page = newPdf.getPage(0);
  // Remove annotations from the page
  page.node.set(PDFName.of('Annots'), newPdf.context.obj([]));
  
  const rect = rects[0];
  const xMin = Math.min(rect.startX, rect.endX);
  const xMax = Math.max(rect.startX, rect.endX);
  const yMin = Math.min(rect.startY, rect.endY);
  const yMax = Math.max(rect.startY, rect.endY);
  
  const [pdfXMin, pdfYMax] = currentViewport.convertToPdfPoint(xMin, yMin);
  const [pdfXMax, pdfYMin] = currentViewport.convertToPdfPoint(xMax, yMax);
  
  page.setCropBox(
    pdfXMin,
    pdfYMin,
    pdfXMax - pdfXMin,
    pdfYMax - pdfYMin
  );

  // Apply rotation according to cumulative currentRotation (modulo 360 for PDF)
  page.setRotation(degrees(currentRotation % 360));

  const cropped = await newPdf.save();
  download(new Blob([cropped], { type: 'application/pdf' }), 'crop-preserved.pdf');
}

// Helper for file download
function download(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}

// Debounce helper to limit execution frequency
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Function to recalculate scale based on container width
function recalcScale() {
    if (pdfDoc) {
        const containerWidth = document.querySelector('.canvas-container').clientWidth;
        pdfDoc.getPage(currentPage).then(page => {
            const unscaledViewport = page.getViewport({ scale: 1 });
            const newScale = containerWidth / unscaledViewport.width;
            scaleDiff = containerWidth - unscaledViewport.width;
            scale = newScale;
            console.log("Recalculated scale:", scale);
            renderPage(currentPage);
        });
    }
}

// Handle window resize for responsiveness using debounce
window.addEventListener("resize", debounce(() => {
    recalcScale();
}, 250));

// Refactored search handler for arXiv numbers / PDF URLs
function handleSearch() {
    const input = searchBar.value.trim();
    // Match arXiv identifiers and URLs (with optional version)
    const arxivRegex = /^(?:arXiv:|https?:\/\/arxiv\.org\/abs\/)?(\d{4}\.\d{5}(v\d+)?)$/i;
    let pdfUrl = "";
    const match = input.match(arxivRegex);
    if (match) {
        pdfUrl = `https://arxiv.org/pdf/${match[1]}`;
    } else {
        // Assume input is a direct PDF URL (from any site)
        pdfUrl = input;
    }
    loadPDFfromURL(pdfUrl);
}

// Handle search on Enter key press
searchBar.addEventListener('keypress', event => {
    if (event.key === 'Enter') {
        event.preventDefault();
        if (searchBar.value.trim() === "") {
            document.getElementById('pdfInput').click();
        } else {
            handleSearch();
        }
    }
});

document.querySelector('.search-btn').addEventListener('click', () => {
    if (searchBar.value.trim() === "") {
        document.getElementById('pdfInput').click();
    } else {
        handleSearch();
    }
});

// Helper functions for loading indicator
function showLoadingIndicator() {
    const indicator = document.getElementById('loadingIndicator');
    if (indicator) indicator.style.display = 'block';
}
function hideLoadingIndicator() {
    const indicator = document.getElementById('loadingIndicator');
    if (indicator) indicator.style.display = 'none';
}

async function loadPDFfromURL(url) {
    showLoadingIndicator();
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Network error');
        const arrayBuffer = await res.arrayBuffer();
        pdfDocBuffer = arrayBuffer.slice(0);
        pdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
        totalPagesSpan.textContent = pdfDoc.numPages;
        currentPage = 1;
        pageInput.value = '1';
        initialContainer.classList.add('pdf-loaded');
        canvasContainer.classList.add('active');
        pageNav.classList.add('active');
        recalcScale();
        renderPage(currentPage);
    } catch (err) {
        console.error("Failed to load PDF:", err);
        alert("Failed to load PDF from the provided URL.");
    } finally {
        hideLoadingIndicator();
    }
}

const DEV_MODE = true;

// Trigger on page load for development mode
window.addEventListener('load', () => {
    if (DEV_MODE) {
        loadPDFfromURL('https://arxiv.org/pdf/2403.07266');
    }
});