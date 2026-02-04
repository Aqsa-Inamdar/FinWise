declare module "pdf-parse" {
  type PdfParseOptions = {
    pagerender?: (pageData: unknown) => string;
    max?: number;
    version?: string;
  };

  type PdfParseResult = {
    text: string;
  };

  export default function pdfParse(
    data: Buffer | Uint8Array,
    options?: PdfParseOptions
  ): Promise<PdfParseResult>;
}
