let pdfDoc = null;
let currentPage = 1;
let scale = 1.5; // Adjust for resolution/quality
let scaleDiff = 0; // New global for container width difference
let isDrawing = false;
let isRendering = false;
let startX, startY, endX, endY;
let pdfDocBuffer = null;
let pdfUrl = null;

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
const customSearchPlaceholder = document.querySelector('.custom-search-placeholder');

// Hide placeholder on focus or when input has text
searchBar.addEventListener('focus', () => {
    customSearchPlaceholder.classList.add('hidden');
});
searchBar.addEventListener('blur', () => {
    if (searchBar.value.trim() === "") {
        customSearchPlaceholder.classList.remove('hidden');
    }
});
searchBar.addEventListener('input', () => {
    if (searchBar.value.trim() === "") {
        customSearchPlaceholder.classList.remove('hidden');
    } else {
        customSearchPlaceholder.classList.add('hidden');
    }
});

// Also, clicking the placeholder (outside the hyperlink) focuses the input
customSearchPlaceholder.addEventListener('click', (e) => {
    if (e.target.id !== 'uploadFileLink') {
        searchBar.focus();
    }
});

const canvasContainer = document.querySelector('.canvas-container');
const initialContainer = document.querySelector('.initial-container');
initialContainer.classList.add('active');
const pageNav = document.querySelector('.page-nav');
const pdfControls = document.querySelector('.pdf-controls');
const toCropBtn = document.querySelector('#to-crop');
const figureListContainer = document.getElementById('figureListContainer');

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
    initialContainer.classList.remove('active');
    canvasContainer.classList.add('active');
    pageNav.classList.add('active');
    pdfControls.classList.add('active');
    toCropBtn.classList.remove('active');
    
    const arrayBuffer = await file.arrayBuffer();
    pdfDocBuffer = arrayBuffer.slice(0);
    pdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
    totalPagesSpan.textContent = pdfDoc.numPages;
    currentPage = 1;
    pageInput.value = '1';
    renderPage(currentPage);
    showInstructionsOverlay(); // show overlay after the PDF is displayed
}

document.querySelector('#prev').addEventListener('click', () => {
    if (currentPage > 1) {
        currentPage--;
        pageInput.value = currentPage;
        renderPage(currentPage);
    }
});

document.querySelector('#next').addEventListener('click', () => {
    if (pdfDoc && currentPage < pdfDoc.numPages) {
        currentPage++;
        pageInput.value = currentPage;
        renderPage(currentPage);
    }
});

document.querySelector('#home').addEventListener('click', () => {
    removeInstructionsOverlay(); // remove overlay when leaving PDF view
    // Clear states and restore initial view
    initialContainer.classList.add('active');
    canvasContainer.classList.remove('active');
    figureListContainer.classList.remove('active');
    // Hide the entire navbar
    pageNav.classList.remove('active');
    pdfControls.classList.remove('active');
    pdfDoc = null;
    pdfDocBuffer = null;
    currentPage = 1;
    pageInput.value = '1';
    rects.length = 0;
    searchBar.value = "";
    customSearchPlaceholder.classList.remove('hidden');
    pdfUrl = null;

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
    removeInstructionsOverlay(); // remove overlay upon page change
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
    removeInstructionsOverlay();
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
    cropBtn.style.backgroundImage = "url('download.svg')";
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
    navBtn.title = "Set cropped orientation";
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
  console.log("Downloading:", filename);
  console.log("Blob size:", blob.size);
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
async function fetchAndShowArxivFigures(arxivId) {
  showLoadingIndicator();
  const tarUrl = `https://arxiv.org/src/${arxivId}`;
  try {
    const extractedFiles = await fetchAndUntar(tarUrl);
    const figureList = document.getElementById('figureList');
    figureList.innerHTML = ''; // Clear old content

    for (const file of extractedFiles) {
      const lowerName = file.name.toLowerCase();
      // Show only typical figure file types
      if (/\.(pdf|png|jpe?g)$/.test(lowerName)) {
        const item = document.createElement('div');
        item.className = 'figure-item';

        const header = document.createElement('div');
        header.className = 'figure-header';
        const downloadBtn = document.createElement('button');
        downloadBtn.title = 'Download figure';
        
        // Create a copy of the buffer for this file
        const fileBuffer = file.buffer.slice(0);
        console.log("file buffer size 0: ", fileBuffer.byteLength);
        
        downloadBtn.addEventListener('click', () => {
          console.log("file buffer size: ", fileBuffer.byteLength);
          const blob = new Blob([fileBuffer]);
          download(blob, file.name);
        });
        
        header.appendChild(downloadBtn);
        item.appendChild(header);

        if (lowerName.endsWith('.pdf')) {
          // Create PDF preview
          const pdfDoc = await pdfjsLib.getDocument({ data: file.buffer }).promise;
          const page = await pdfDoc.getPage(1);
          const viewport = page.getViewport({ scale: 1 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext('2d');
          await page.render({ canvasContext: context, viewport }).promise;

          item.appendChild(canvas);
        } else {
          const blob = new Blob([file.buffer]);
          const img = document.createElement('img');
          img.src = URL.createObjectURL(blob);
          img.alt = file.name;
          item.appendChild(img);
        }
        figureList.appendChild(item);
      }
    }

    figureListContainer.classList.add('active');
    // For file view, show nav with home and crop button
    pageNav.classList.add('active');
    pdfControls.classList.remove('active');
    toCropBtn.classList.add('active');
    // Hide PDF UI and initial view via class toggling:
    canvasContainer.classList.remove('active');
    initialContainer.classList.remove('active');
  } catch (err) {
    console.error("Failed to untar arXiv source:", err);
    alert("Failed to untar arXiv source.");
  } finally {
    hideLoadingIndicator();
  }
}

function handleSearch() {
  const input = searchBar.value.trim();
  const arxivRegex = /^(?:arXiv:|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}(v\d+)?)$/i;
  const match = input.match(arxivRegex);
  if (match) {
    console.log("Matched arXiv ID:", match[1]);
    const arxivId = match[1];
    fetchAndShowArxivFigures(arxivId);
    pdfUrl = `https://arxiv.org/pdf/${arxivId}`;
  } else {
    // Assume input is a direct PDF URL
    console.log("Assuming input is a non arxiv direct PDF URL:", input);
    pdfUrl = input;
    loadPDFfromURL(pdfUrl);
  }
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

// In loadPDFfromURL: show pdf view with full navigation
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
        initialContainer.classList.remove('active');
        canvasContainer.classList.add('active');
        // Set nav to PDF mode
        pageNav.classList.add('active');
        pdfControls.classList.add('active');
        toCropBtn.classList.remove('active');
        recalcScale();
        await renderPage(currentPage);
        showInstructionsOverlay();
    } catch (err) {
        console.error("Failed to load PDF:", err);
        alert("Failed to load PDF from the provided URL.");
    } finally {
        hideLoadingIndicator();
    }
}

// Add event listener for "to-crop" button to switch into manual cropping (pdf view) mode
toCropBtn.addEventListener('click', () => {
    // Hide file view
    figureListContainer.classList.remove('active');
    console.log("Switching to manual cropping mode for PDF:", pdfUrl);
    if (pdfUrl) {
      loadPDFfromURL(pdfUrl);
    }
});

const DEV_MODE = true;

// // Trigger on page load for development mode
// window.addEventListener('load', () => {
//     if (DEV_MODE) {
//       searchBar.value = 'https://arxiv.org/pdf/2403.07266';
//       handleSearch();
//     }
// });

// Updated: show instructions overlay centered on the screen
function showInstructionsOverlay() {
    if (!document.getElementById('instructionOverlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'instructionOverlay';
        overlay.textContent = 'Click and drag to draw a rectangle around a figure';
        // Center overlay on screen
        overlay.style.position = 'fixed'; // changed from 'absolute' to 'fixed'
        overlay.style.top = '50%';
        overlay.style.left = '50%';
        overlay.style.transform = 'translate(-50%, -50%)';
        overlay.style.padding = '1rem 2rem';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
        overlay.style.color = 'white';
        overlay.style.borderRadius = '8px';
        overlay.style.fontSize = '1rem';
        overlay.style.zIndex = '1000';
        document.body.appendChild(overlay); // append to body so that it centers on the screen
    }
}

// Remove overlay if it exists
function removeInstructionsOverlay() {
    const overlay = document.getElementById('instructionOverlay');
    if (overlay) overlay.remove();
}

let tarBuffer = null;
let extractedFiles = [];

async function fetchAndUntar(tarUrl) {
  try {
    console.log(`Fetching tar file from: ${tarUrl}`);
    const response = await fetch(tarUrl);
    if (!response.ok) {
      throw new Error(`Network response was not ok: ${response.statusText}`);
    }
    const buffer = await response.arrayBuffer();
    console.log(`Tar file fetched, size: ${buffer.byteLength} bytes`);
    if (buffer.byteLength === 0) {
      throw new Error('Fetched tar file is empty.');
    }
    console.log('Starting decompression process...');
    
    // Decompress the tar.gz file
    const decompressedBuffer = pako.ungzip(new Uint8Array(buffer)).buffer;
    console.log(`Decompression completed, size: ${decompressedBuffer.byteLength} bytes`);
    
    console.log('Starting untar process...');
    const extractedFiles = await untar(decompressedBuffer);
    console.log('Untar process completed.');
    
    // Process and decode file names
    extractedFiles.forEach(file => {
      if (typeof file.name !== 'string') {
        file.name = new TextDecoder('utf-8').decode(file.name);
      }
      console.log('Extracted file:', file.name);
    });
    console.log(`Total extracted files: ${extractedFiles.length}`);
    
    // Count and log figure files based on extension
    const figureFiles = extractedFiles.filter(file =>
      /\.(pdf|png|jpe?g)$/i.test(file.name)
    );
    console.log(`Figure files count: ${figureFiles.length}`);
    figureFiles.forEach(file => console.log('Figure file:', file.name));
    
    return extractedFiles;
  } catch (error) {
    console.error('Error fetching or untarring file:', error);
  }
}