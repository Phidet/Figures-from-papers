let pdfDoc = null;
let currentPage = 1;
let scale = 1.5; // Adjust for resolution/quality
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

// Remove or comment out old uploadZone handlers
// uploadZone.addEventListener('click', () => { document.getElementById('pdfInput').click(); });
// uploadZone.addEventListener('dragover', ...);
// uploadZone.addEventListener('dragleave', ...);
// uploadZone.addEventListener('drop', ...);

// New handler for the upload file link
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

// New helper to clear crop UI (rectangle and floating button)
function clearCropUI() {
    rects.length = 0;
    const existingButton = document.querySelector('.floating-download');
    if (existingButton) { existingButton.remove(); }
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
  // Remove floating button immediately when starting new rectangle
  const existingButton = document.querySelector('.floating-download');
  if (existingButton) {
    existingButton.remove();
  }
  
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
  rects.length = 0;
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
    drawAllRects();
    updateFloatingButton(rects[activeRectIndex]); // Keep this for live updates during resize
  } else if (isDrawing && activeRectIndex >= 0) {
    rects[activeRectIndex].endX = e.offsetX;
    rects[activeRectIndex].endY = e.offsetY;
    drawAllRects();
  }
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
    ctx.strokeStyle = 'red';
    ctx.strokeRect(r.startX, r.startY, r.endX - r.startX, r.endY - r.startY);
    
    // Draw corner circles
    ctx.fillStyle = 'red';
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

// Fix: Use mouseY correctly in isOverCorner
function isOverCorner(mouseX, mouseY, cornerX, cornerY) {
  return Math.abs(cornerX - mouseX) < cornerSize && 
         Math.abs(cornerY - mouseY) < cornerSize;
}

function updateFloatingButton(rect) {
    // Remove any existing button
    const existingButton = document.querySelector('.floating-download');
    if (existingButton) {
        existingButton.remove();
    }

    if (!rect) return;

    const button = document.createElement('button');
    button.className = 'floating-download';
    
    // Position button above the rectangle
    const centerX = (rect.startX + rect.endX) / 2;
    const top = Math.min(rect.startY, rect.endY) - 46; // 36px button + 10px margin
    
    button.style.left = `${centerX - 18}px`; // 18px is half button width
    button.style.top = `${top}px`;
    
    button.addEventListener('click', cropPreserved);
    document.querySelector('.canvas-wrapper').appendChild(button);
}

// Remove the exportPreserved button event listener since we're not using it anymore
// document.getElementById('exportPreserved').addEventListener('click', cropPreserved);

async function cropPreserved() {
  if (!pdfDocBuffer || !pdfDoc || !currentViewport || rects.length === 0) return;
  // Import PDFName along with PDFDocument
  const { PDFDocument, PDFName } = PDFLib;
  
  // Create a new PDF with just the current page
  const newPdf = await PDFDocument.create();
  const sourcePdf = await PDFDocument.load(pdfDocBuffer.slice(0));
  const [copiedPage] = await newPdf.copyPages(sourcePdf, [currentPage - 1]);
  newPdf.addPage(copiedPage);
  
  const page = newPdf.getPage(0);
  // Remove annotations (e.g., hyperlink boxes) from the page
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

// Handle window resize for responsiveness
window.addEventListener("resize", debounce(() => {
    if (pdfDoc) {
        const containerWidth = document.querySelector('.canvas-container').clientWidth;
        // Recalculate new scale based on the original unscaled page width
        pdfDoc.getPage(currentPage).then(page => {
            const unscaledViewport = page.getViewport({ scale: 1 });
            const newScale = containerWidth / unscaledViewport.width;
            scale = newScale;
            renderPage(currentPage);
        });
    }
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

// Updated search event listeners to trigger file upload when the input is empty
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

// Updated loadPDFfromURL to show loading indicator during fetch
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
        // Show PDF view
        initialContainer.classList.add('pdf-loaded');
        canvasContainer.classList.add('active');
        pageNav.classList.add('active');
        renderPage(currentPage);
    } catch (err) {
        console.error("Failed to load PDF:", err);
        alert("Failed to load PDF from the provided URL.");
    } finally {
        hideLoadingIndicator();
    }
}