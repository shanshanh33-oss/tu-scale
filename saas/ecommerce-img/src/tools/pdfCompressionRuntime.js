import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

let pdfJsPromise = null

export const loadCompressionPdfJs = async () => {
  if (!pdfJsPromise) {
    pdfJsPromise = import('pdfjs-dist/build/pdf.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
      return pdfjs
    })
  }
  return pdfJsPromise
}
