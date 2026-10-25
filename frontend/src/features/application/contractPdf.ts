import htmlToPdfmake from 'html-to-pdfmake'
import pdfMake from 'pdfmake/build/pdfmake'
import fonts from 'pdfmake/build/vfs_fonts'
import type { Content, ContentTable } from 'pdfmake/interfaces'

pdfMake.addVirtualFileSystem(fonts)

function fitTables(content: Content): void {
  if (Array.isArray(content)) {
    content.forEach(fitTables)
    return
  }
  if (!content || typeof content !== 'object') return
  if ('table' in content) {
    const node = content as ContentTable
    node.table.widths = Array(node.table.body[0]?.length ?? 1).fill('*')
    node.table.headerRows = 1
    node.table.body.forEach((row) => row.forEach((cell) => fitTables(cell as Content)))
  }
  if ('stack' in content) content.stack?.forEach(fitTables)
}

export async function downloadContractPdf(number: string, html: string): Promise<void> {
  const content = htmlToPdfmake(html, {
    defaultStyles: {
      h2: { fontSize: 14, bold: true, alignment: 'center', margin: [0, 0, 0, 8] },
      h3: { fontSize: 11, bold: true, margin: [0, 14, 0, 6] },
      p: { margin: [0, 3, 0, 3] },
    },
  }) as unknown as Content
  fitTables(content)
  await pdfMake.createPdf({
    pageSize: 'A4',
    pageMargins: [32, 36, 32, 36],
    info: { title: `Кредитный договор № ${number}` },
    defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.2 },
    styles: {
      meta: { fontSize: 8, color: '#6b6e66', alignment: 'center' },
      note: { fontSize: 8, color: '#6b6e66' },
      sub: { margin: [16, 0, 0, 0] },
      schedule: { fontSize: 8 },
    },
    content,
    footer: (page, pages) => ({ text: `${page} / ${pages}`, alignment: 'center', fontSize: 8, margin: [0, 12, 0, 0] }),
  }).download(`Договор-${number.replace(/[^\p{L}\p{N}._-]/gu, '_')}.pdf`)
}
