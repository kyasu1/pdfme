import { Plugin, PDFRenderProps, Schema } from '@pdfme/common';
import { IdCard } from 'lucide';
import { createSvgStr, isEditable, convertForPdfLayoutProps, hex2PrintingColor } from '../utils.js';
import { DEFAULT_OPACITY } from '../constants.js';
import { UIRenderProps, px2mm, pt2mm, mm2pt } from '@pdfme/common';
import { TextSchema } from '../text/types.js';
import textSchema from '../text/index.js';
import { BarcodeSchema } from '../barcodes/types.js';
import barcodes from '../barcodes/index.js';
import { ImageSchema } from '../graphics/image.js';
import * as imageSchema from '../graphics/image.js';
import * as svgSchema from '../graphics/svg.js';
import { ShapeSchema } from '../shapes/rectAndEllipse.js';
import * as lineSchema from '../shapes/line.js';
import * as rectAndEllipseSchema from '../shapes/rectAndEllipse.js';
import { BarcodeTypes } from '../barcodes/types.js';

export interface CardSchema extends Schema {
  type: 'card';
  effectiveWidth: number;
  effectiveHeight: number;
  borderWidth: number;
  borderColor: string;
  xGutter?: number;
  yGutter?: number;
  schemas: S[];
  fields: Field[];
}

type S =
  | (TextSchema & Schema)
  | (BarcodeSchema & Schema)
  | (ImageSchema & Schema)
  | (ShapeSchema & Schema)
  | (lineSchema.LineSchema & Schema)
  | (svgSchema.SVGSchema & Schema);

export type Field = {
  key: string;
  value: string;
};

const cardSchema: Plugin<CardSchema> = {
  pdf: async (arg: PDFRenderProps<CardSchema>) => {
    const { basePdf, value, schema, pdfDoc, pdfLib, page, options, _cache } = arg;

    if (!value) return;

    const fields: Field[] = schema.fields;
    const pageHeight = page.getHeight();

    const { position, width, height, rotate, opacity } = convertForPdfLayoutProps({
      schema,
      pageHeight,
    });
    const { colorType } = options;

    let currentX = 0;
    let currentY = 0;
    let rowHeight = 0;
    let pageIndex = 0;
    const xGutter = schema.xGutter ? schema.xGutter : 0;
    const yGutter = schema.yGutter ? schema.yGutter : 0;

    const pages = pdfDoc.getPages();

    for (const fieldGroup of fields as Field[]) {
      if (currentX + schema.width > schema.effectiveWidth) {
        currentX = 0;
        currentY += rowHeight + yGutter;
        rowHeight = 0;
      }
      if (currentY + schema.height > schema.effectiveHeight) {
        currentX = 0;
        currentY = 0;
        rowHeight = 0;
        pageIndex++;
      }

      if (!pages[pageIndex]) {
        pages[pageIndex] = pdfDoc.addPage();
      }

      for (const [key, value] of Object.entries(fieldGroup)) {
        const fieldSchema: S | undefined = schema.schemas.find(
          (element: S) => element.name === key
        );

        if (fieldSchema) {
          const newPosition = {
            x: schema.position.x + currentX + fieldSchema.position.x,
            y: schema.position.y + currentY + fieldSchema.position.y,
          };
          const updatedSchema = { ...fieldSchema, position: newPosition };
          const currentPage = pages[pageIndex];

          switch (fieldSchema.type) {
            case 'text':
              await textSchema.pdf({
                value,
                schema: updatedSchema as TextSchema,
                basePdf,
                pdfLib,
                pdfDoc,
                page: currentPage,
                options,
                _cache,
              });
              break;
            case 'image':
              await imageSchema.default.pdf({
                value,
                schema: updatedSchema as ImageSchema,
                basePdf,
                pdfLib,
                pdfDoc,
                page: currentPage,
                options,
                _cache,
              });
              break;
            case 'svg':
              await svgSchema.default.pdf({
                value,
                schema: updatedSchema as svgSchema.SVGSchema,
                basePdf,
                pdfLib,
                pdfDoc,
                page: currentPage,
                options,
                _cache,
              });
            case 'line':
              await lineSchema.default.pdf({
                value: '',
                schema: updatedSchema as lineSchema.LineSchema,
                basePdf,
                pdfLib,
                pdfDoc,
                page: currentPage,
                options,
                _cache,
              });

              break;
            case 'rect':
              await rectAndEllipseSchema.rectangle.pdf({
                value: '',
                schema: updatedSchema as rectAndEllipseSchema.ShapeSchema,
                basePdf,
                pdfLib,
                pdfDoc,
                page: currentPage,
                options,
                _cache,
              });

              break;
            case 'ellipse':
              await rectAndEllipseSchema.ellipse.pdf({
                value: '',
                schema: updatedSchema as rectAndEllipseSchema.ShapeSchema,
                basePdf,
                pdfLib,
                pdfDoc,
                page: currentPage,
                options,
                _cache,
              });

              break;
            default:
              if (barcodes[fieldSchema.type as BarcodeTypes]) {
                await barcodes[fieldSchema.type as BarcodeTypes].pdf({
                  value,
                  schema: updatedSchema as BarcodeSchema,
                  basePdf,
                  pdfLib,
                  pdfDoc,
                  page: currentPage,
                  options,
                  _cache,
                });
              }
              break;
          }
        }
      }

      pages[pageIndex].drawRectangle({
        x: mm2pt(schema.position.x + currentX),
        y: pageHeight - mm2pt(schema.position.y + currentY + schema.height),
        width: width,
        height: height,
        borderWidth: schema.borderWidth,
        borderColor: hex2PrintingColor(schema.borderColor, colorType),
        opacity,
      });
      //
      currentX += schema.width + xGutter;
      rowHeight = Math.max(rowHeight, schema.height);
    }
  },
  ui: (arg: UIRenderProps<CardSchema>) => {
    const {
      value,
      rootElement,
      mode,
      onChange,
      stopEditing,
      tabIndex,
      placeholder,
      theme,
      schema,
    } = arg;
    const editable = isEditable(mode, schema);
  },
  propPanel: {
    schema: {},
    defaultSchema: {
      name: '',
      type: 'card',
      content: '',
      position: { x: 0, y: 0 },
      width: 40,
      height: 40,
      // If the value of "rotate" is set to undefined or not set at all, rotation will be disabled in the UI.
      // Check this document: https://pdfme.com//docs/custom-schemas#learning-how-to-create-from-pdfmeschemas-code
      rotate: 0,

      effectiveWidth: 210.0,
      effectiveHeight: 297.0,
      xGutter: 0.0,
      yGutter: 0.0,
      borderWidth: 1.0,
      borderColor: '#999999',
      opacity: DEFAULT_OPACITY,
      fields: [],
      schemas: [],
    },
  },

  icon: createSvgStr(IdCard),
};

export default cardSchema;
