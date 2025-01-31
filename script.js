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
  isDrawing = true;
  [startX, startY] = [e.offsetX, e.offsetY];
});

canvas.addEventListener('mousemove', (e) => {
  if (!isDrawing) return;
  endX = e.offsetX;
  endY = e.offsetY;
  drawRect(); // Redraw rectangle on move
});

canvas.addEventListener('mouseup', () => {
  isDrawing = false;
});

function drawRect() {
  if (isRendering) return;
  
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(offScreenCanvas, 0, 0);
  ctx.strokeStyle = 'red';
  ctx.strokeRect(startX, startY, endX - startX, endY - startY);
}

document.getElementById('exportPreserved').addEventListener('click', cropPreserved);

async function cropPreserved() {
  if (!pdfDocBuffer || !pdfDoc || !currentViewport) return;
  const { PDFDocument } = PDFLib; // from pdf-lib.min.js
  const loadedPdf = await PDFDocument.load(pdfDocBuffer.slice(0));
  const page = loadedPdf.getPage(currentPage - 1); // zero-based

  // Determine min/max of the drawn rectangle
  const xMin = Math.min(startX, endX);
  const xMax = Math.max(startX, endX);
  const yMin = Math.min(startY, endY);
  const yMax = Math.max(startY, endY);

  // Convert each corner to PDF coordinates using the unscaled viewport
  const [pdfXMin, pdfYMax] = currentViewport.convertToPdfPoint(xMin, yMin);
  const [pdfXMax, pdfYMin] = currentViewport.convertToPdfPoint(xMax, yMax);

  // Apply the crop box
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
