import { PDFFont, PDFDocument } from '@pdfme/pdf-lib';
import type { PDFPage } from '@pdfme/pdf-lib';
import type { Font as FontKitFont } from 'fontkit';
import type { FlowingTextSchema } from './types';
import {
  PDFRenderProps,
  ColorType,
  Font,
  getDefaultFont,
  getFallbackFontName,
  mm2pt,
} from '@pdfme/common';
import {
  VERTICAL_ALIGN_TOP,
  VERTICAL_ALIGN_MIDDLE,
  VERTICAL_ALIGN_BOTTOM,
  DEFAULT_FONT_SIZE,
  DEFAULT_ALIGNMENT,
  DEFAULT_VERTICAL_ALIGNMENT,
  DEFAULT_LINE_HEIGHT,
  DEFAULT_CHARACTER_SPACING,
  DEFAULT_FONT_COLOR,
} from './constants.js';
import {
  calculateDynamicFontSize,
  heightOfFontAtSize,
  getFontDescentInPt,
  getFontKitFont,
  widthOfTextAtSize,
  splitTextToSize,
} from './helper.js';
import { convertForPdfLayoutProps, rotatePoint, hex2PrintingColor } from '../utils.js';

const embedAndGetFontObj = async (arg: {
  pdfDoc: PDFDocument;
  font: Font;
  _cache: Map<any, any>;
}) => {
  const { pdfDoc, font, _cache } = arg;
  if (_cache.has(pdfDoc)) {
    return _cache.get(pdfDoc) as { [key: string]: PDFFont };
  }

  const fontValues = await Promise.all(
    Object.values(font).map(async (v) => {
      let fontData = v.data;
      if (typeof fontData === 'string' && fontData.startsWith('http')) {
        fontData = await fetch(fontData).then((res) => res.arrayBuffer());
      }
      return pdfDoc.embedFont(fontData, {
        subset: typeof v.subset === 'undefined' ? true : v.subset,
      });
    })
  );

  const fontObj = Object.keys(font).reduce(
    (acc, cur, i) => Object.assign(acc, { [cur]: fontValues[i] }),
    {} as { [key: string]: PDFFont }
  );

  _cache.set(pdfDoc, fontObj);
  return fontObj;
};

const getFontProp = ({
  value,
  fontKitFont,
  schema,
  colorType,
}: {
  value: string;
  fontKitFont: FontKitFont;
  colorType?: ColorType;
  schema: FlowingTextSchema;
}) => {
  const fontSize = schema.dynamicFontSize
    ? calculateDynamicFontSize({ textSchema: schema, fontKitFont, value })
    : schema.fontSize ?? DEFAULT_FONT_SIZE;
  const color = hex2PrintingColor(schema.fontColor || DEFAULT_FONT_COLOR, colorType);

  return {
    alignment: schema.alignment ?? DEFAULT_ALIGNMENT,
    verticalAlignment: schema.verticalAlignment ?? DEFAULT_VERTICAL_ALIGNMENT,
    lineHeight: schema.lineHeight ?? DEFAULT_LINE_HEIGHT,
    characterSpacing: schema.characterSpacing ?? DEFAULT_CHARACTER_SPACING,
    fontSize,
    color,
  };
};

export const pdfRender = async (arg: PDFRenderProps<FlowingTextSchema>) => {
  const { value, page, pdfDoc, pdfLib, options, schema, _cache } = arg;
  if (!value) return;

  const { font = getDefaultFont(), colorType } = options;

  const [pdfFontObj, fontKitFont] = await Promise.all([
    embedAndGetFontObj({ pdfDoc, font, _cache }),
    getFontKitFont(schema.fontName, font, _cache),
  ]);
  const fontProp = getFontProp({ value, fontKitFont, schema, colorType });

  const { fontSize, color, alignment, verticalAlignment, lineHeight, characterSpacing } = fontProp;

  const fontName = (
    schema.fontName ? schema.fontName : getFallbackFontName(font)
  ) as keyof typeof pdfFontObj;
  const pdfFontValue = pdfFontObj && pdfFontObj[fontName];

  const pageHeight = page.getHeight();
  const {
    width,
    height,
    position: { x, y },
    opacity,
  } = convertForPdfLayoutProps({ schema, pageHeight, applyRotateTranslate: false });

  if (schema.backgroundColor) {
    const color = hex2PrintingColor(schema.backgroundColor, colorType);
    page.drawRectangle({ x, y, width, height, color });
  }

  const firstLineTextHeight = heightOfFontAtSize(fontKitFont, fontSize);
  const descent = getFontDescentInPt(fontKitFont, fontSize);
  const halfLineHeightAdjustment = lineHeight === 0 ? 0 : ((lineHeight - 1) * fontSize) / 2;

  const lines = splitTextToSize({
    value,
    characterSpacing,
    fontSize,
    fontKitFont,
    boxWidthInPt: width,
  });

  // Text lines are rendered from the bottom upwards, we need to adjust the position down
  let yOffset = 0;
  if (verticalAlignment === VERTICAL_ALIGN_TOP) {
    yOffset = firstLineTextHeight + halfLineHeightAdjustment;
  } else {
    const otherLinesHeight = lineHeight * fontSize * (lines.length - 1);

    if (verticalAlignment === VERTICAL_ALIGN_BOTTOM) {
      yOffset = height - otherLinesHeight + descent - halfLineHeightAdjustment;
    } else if (verticalAlignment === VERTICAL_ALIGN_MIDDLE) {
      yOffset =
        (height - otherLinesHeight - firstLineTextHeight + descent) / 2 + firstLineTextHeight;
    }
  }

  // basePdfからマージン情報を取得する方法がわからないので、とりあえず決め打ち
  const topMarginMm = 20;
  const bottomMarginMm = 20;
  const pageHeightMm = 297;

  let indexOffset = 0;
  let pageCounter = 0;
  let yTopMm = schema.position.y;
  let yBottomMm = schema.position.y + schema.height;

  let linesSplittedPages: string[][] = lines.reduce(
    (acc: string[][], current: string, index: number) => {
      const rowYOffset = lineHeight * fontSize * (index - indexOffset);
      let yLine = pageHeight - mm2pt(yTopMm) - yOffset - rowYOffset;
      if (yLine <= pageHeight - mm2pt(yBottomMm)) {
        acc[++pageCounter] = [current];
        indexOffset = index;
        yTopMm = topMarginMm;
        yBottomMm = pageHeightMm - bottomMarginMm;
        return acc;
      } else {
        if (acc[pageCounter]) {
          acc[pageCounter].push(current);
        } else {
          acc[pageCounter] = [current];
        }
        return acc;
      }
    },
    []
  );

  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

  let pages: PDFPage[] = pdfDoc.getPages();
  linesSplittedPages.forEach((linesInPage, pageCount: number) => {
    if (pageCount !== 0) {
      if (!pages[pageCount]) {
        pages.push(pdfDoc.addPage());
      }
      // Sample page header and footer
      pages[pageCount].drawRectangle({
        x: mm2pt(10.0),
        y: pageHeight - mm2pt(20.0),
        width: mm2pt(190.0),
        height: mm2pt(5.0),
        // borderColor: '#000000',
        borderWidth: 1,
      });
      pages[pageCount].drawRectangle({
        x: mm2pt(10.0),
        y: mm2pt(10.0),
        width: mm2pt(190.0),
        height: mm2pt(5.0),
        // borderColor: '#000000',
        borderWidth: 1,
      });
    } else {
      pages[pageCount].drawRectangle({
        x: mm2pt(10.0),
        y: mm2pt(10.0),
        width: mm2pt(190.0),
        height: mm2pt(5.0),
        // borderColor: '#000000',
        borderWidth: 1,
      });
    }
    const yTopMm = pageCount === 0 ? schema.position.y : topMarginMm;

    linesInPage.forEach((line, rowIndex) => {
      const trimmed = line.replace('\n', '');
      const textWidth = widthOfTextAtSize(trimmed, fontKitFont, fontSize, characterSpacing);
      const rowYOffset = lineHeight * fontSize * rowIndex;

      // Adobe Acrobat Reader shows an error if `drawText` is called with an empty text
      if (line === '') {
        // return; // this also works
        line = '\r\n';
      }

      let xLine = x;
      if (alignment === 'center') {
        xLine += (width - textWidth) / 2;
      } else if (alignment === 'right') {
        xLine += width - textWidth;
      }

      let yLine = pageHeight - mm2pt(yTopMm) - yOffset - rowYOffset;

      let spacing = characterSpacing;
      if (alignment === 'justify' && line.slice(-1) !== '\n') {
        // if alignment is `justify` but the end of line is not newline, then adjust the spacing
        const iterator = segmenter.segment(trimmed)[Symbol.iterator]();
        const len = Array.from(iterator).length;
        spacing += (width - textWidth) / len;
      }
      pages[pageCount].pushOperators(pdfLib.setCharacterSpacing(spacing));

      pages[pageCount].drawText(trimmed, {
        x: xLine,
        y: yLine,
        size: fontSize,
        color,
        lineHeight: lineHeight * fontSize,
        font: pdfFontValue,
        opacity,
      });
    });
  });
};
