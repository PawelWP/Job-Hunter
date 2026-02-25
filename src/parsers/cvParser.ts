import path from 'path';
import { PDFParse } from 'pdf-parse';

export async function parsePDF(filePath: string): Promise<string> {
  const absPath = path.resolve(filePath);
  const parser = new PDFParse({ url: absPath });
  const result = await parser.getText();
  return (result.text as string)
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}
