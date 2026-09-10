/* Small platform + printing helpers shared across pages. */

/** True on any Android browser or the WorkshopIQ APK WebView. */
export const isAndroid = () => /android/i.test(navigator.userAgent);

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface QrSheet {
  /** Big heading — job number or certificate number. */
  title: string;
  /** Smaller line under the heading — customer name etc. */
  subtitle?: string;
  /** QR image (data URI from the API). */
  qrPng: string;
  /** Footer line under the QR. */
  caption?: string;
  /** Optional diagonal stamp over a dimmed QR (e.g. "CHECKED IN"). */
  stamp?: string;
}

/**
 * Print a single-page QR sheet.
 *
 * The old approach (window.open + setTimeout(print, 250)) raced the QR image:
 * if print fired before the image had loaded/decoded, the sheet came out with
 * a BLANK square where the QR should be. Here the print call lives INSIDE the
 * printed document and only runs once its own `load` event has fired and the
 * QR <img> reports complete — so the code is always on the paper.
 *
 * If the popup is blocked, we fall back to printing from a hidden iframe.
 */
export function printQrSheet({ title, subtitle, qrPng, caption, stamp }: QrSheet) {
  const qrBlock = stamp
    ? `<div style="position:relative;display:inline-block">` +
      `<img class="qr" src="${qrPng}" style="width:300px;height:300px;filter:grayscale(1) opacity(0.3)"/>` +
      `<div style="position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center">` +
      `<div style="transform:rotate(-9deg);background:#2e7d32;color:#fff;font-weight:800;` +
      `letter-spacing:2px;font-size:26px;padding:12px 40px;border:3px solid #fff;` +
      `box-shadow:0 6px 18px rgba(0,0,0,0.3);white-space:nowrap">${esc(stamp)}</div>` +
      `</div></div>`
    : `<img class="qr" src="${qrPng}" style="width:300px;height:300px"/>`;

  const html =
    `<!doctype html><html><head><title>${esc(title)}</title></head>` +
    `<body style="text-align:center;font-family:sans-serif;padding:40px;color:#111">` +
    `<h2 style="margin:0 0 4px">${esc(title)}</h2>` +
    (subtitle ? `<div style="color:#555;margin-bottom:20px">${esc(subtitle)}</div>` : '') +
    qrBlock +
    (caption
      ? `<p style="font-size:13px;color:#555;margin-top:16px">${esc(caption)}</p>`
      : '') +
    // Print only once the document AND the QR image are fully loaded —
    // printing early is what produced blank QR sheets.
    `<script>window.addEventListener('load',function(){` +
    `var i=document.querySelector('img.qr');` +
    `var go=function(){setTimeout(function(){window.focus();window.print();},150);};` +
    `if(i&&!i.complete){i.onload=go;i.onerror=go;}else{go();}` +
    `});</` +
    `script></body></html>`;

  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    return;
  }

  // Popup blocked — print from a hidden same-page iframe instead.
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  // Give the print dialog plenty of time before cleaning up.
  setTimeout(() => frame.remove(), 60000);
}
