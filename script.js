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

document.getElementById('pdfInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const arrayBuffer = await file.arrayBuffer();
  // Create a copy for pdf-lib to avoid the detached buffer issue.
  pdfDocBuffer = arrayBuffer.slice(0);
  pdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
  renderPage(currentPage);
});

async function renderPage(pageNum) {
  if (isRendering) return;
  isRendering = true;
  
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  currentViewport = viewport; // Store the viewport for coordinate conversion
  
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  offScreenCanvas.width = viewport.width;
  offScreenCanvas.height = viewport.height;
  
  await page.render({
    canvasContext: offScreenCtx,
    viewport,
  }).promise;
  
  ctx.drawImage(offScreenCanvas, 0, 0);
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
  } else if (isDrawing && activeRectIndex >= 0) {
    rects[activeRectIndex].endX = e.offsetX;
    rects[activeRectIndex].endY = e.offsetY;
    drawAllRects();
  }
});

canvas.addEventListener('mouseup', () => {
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

function isOverCorner(mouseX, mouseY, cornerX, cornerY) {
  return Math.abs(cornerX - mouseX) < cornerSize && 
         Math.abs(cornerY - mouseY) < cornerSize;
}

document.getElementById('exportPreserved').addEventListener('click', cropPreserved);

async function cropPreserved() {
  if (!pdfDocBuffer || !pdfDoc || !currentViewport || rects.length === 0) return;
  const { PDFDocument } = PDFLib;
  const loadedPdf = await PDFDocument.load(pdfDocBuffer.slice(0));
  const page = loadedPdf.getPage(currentPage - 1);

  const rect = rects[0]; // Get the first (and only) rectangle
  // Determine min/max of the drawn rectangle
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

  const cropped = await loadedPdf.save();
  download(new Blob([cropped], { type: 'application/pdf' }), 'crop-preserved.pdf');
}

// Helper for file download
function download(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
}
