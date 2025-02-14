import type * as CSS from 'csstype';
import { createSvgStr, convertForPdfLayoutProps, isEditable, addAlphaToHex } from '../utils.js';
import { Plugin, UIRenderProps } from '@pdfme/common';
import type { PDFRenderProps, Schema } from '@pdfme/common';
import * as Lucide from 'lucide';
import QRCode from 'qrcode';
import { DEFAULT_OPACITY, HEX_COLOR_PATTERN } from '../constants.js';

export const DEFAULT_BARCODE_BG_COLOR = '#ffffff';
export const DEFAULT_BARCODE_COLOR = '#000000';

export interface QRCodeSchema extends Schema {
  backgroundColor: string;
  barColor: string;
}

/*
  uiRender
*/
const fullSize = { width: '100%', height: '100%' };

const blobToDataURL = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

const createQRCodeImageElm = async (value: string) => {
  const qrCodeDataURL = await QRCode.toDataURL(value);
  const img = document.createElement('img');
  img.src = qrCodeDataURL;
  const imgStyle: CSS.Properties = { ...fullSize, borderRadius: 0 };
  Object.assign(img.style, imgStyle);
  return img;
};

export const createErrorElm = () => {
  const container = document.createElement('div');
  const containerStyle: CSS.Properties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  };
  Object.assign(container.style, containerStyle);

  const span = document.createElement('span');
  const spanStyle: CSS.Properties = {
    color: 'white',
    background: 'red',
    padding: '0.25rem',
    fontSize: '12pt',
    fontWeight: 'bold',
    borderRadius: '2px',
    fontFamily: "'Open Sans', sans-serif",
  };
  Object.assign(span.style, spanStyle);

  span.textContent = 'ERROR';
  container.appendChild(span);

  return container;
};

//

const uiRender = async (arg: UIRenderProps<QRCodeSchema>) => {
  const { value, rootElement, mode, onChange, stopEditing, tabIndex, placeholder, schema, theme } =
    arg;

  const container = document.createElement('div');
  const containerStyle: CSS.Properties = {
    ...fullSize,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Open Sans', sans-serif",
  };
  Object.assign(container.style, containerStyle);
  rootElement.appendChild(container);
  const editable = isEditable(mode, schema);
  if (editable) {
    const input = document.createElement('input');
    const inputStyle: CSS.Properties = {
      width: '100%',
      position: 'absolute',
      textAlign: 'center',
      fontSize: '12pt',
      fontWeight: 'bold',
      color: theme.colorWhite,
      backgroundColor: editable || value ? addAlphaToHex('#000000', 80) : 'none',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'auto',
    };
    Object.assign(input.style, inputStyle);
    input.value = value;
    input.placeholder = placeholder || '';
    input.tabIndex = tabIndex || 0;
    input.addEventListener('change', (e: Event) => {
      onChange && onChange({ key: 'content', value: (e.target as HTMLInputElement).value });
    });
    input.addEventListener('blur', () => {
      stopEditing && stopEditing();
    });
    container.appendChild(input);
    input.setSelectionRange(value.length, value.length);
    if (mode === 'designer') {
      input.focus();
    }
  }

  if (!value) return;
  try {
    // if (!validateBarcodeInput(schema.type, value))
    //   throw new Error('[@pdfme/schemas/barcodes] Invalid barcode input');
    const imgElm = await createQRCodeImageElm(value);
    container.appendChild(imgElm);
  } catch (err) {
    console.error(`[@pdfme/ui] ${err}`);
    container.appendChild(createErrorElm());
  }
};

/*
  pdfRender
*/
const getBarcodeCacheKey = (schema: QRCodeSchema & Schema, value: string) => {
  return `${schema.type}${schema.backgroundColor}${schema.barColor}${value}`;
};

const pdfRender = async (arg: PDFRenderProps<QRCodeSchema>) => {
  const { value, schema, pdfDoc, page, _cache } = arg;
  if (!value) return;

  const inputBarcodeCacheKey = getBarcodeCacheKey(schema, value);
  let image = _cache.get(inputBarcodeCacheKey);
  if (!image) {
    const dataURL = (await QRCode.toDataURL(value)).split(',')[1];

    image = await pdfDoc.embedPng(dataURL);

    _cache.set(inputBarcodeCacheKey, image);
  }

  const pageHeight = page.getHeight();
  const {
    width,
    height,
    rotate,
    position: { x, y },
    opacity,
  } = convertForPdfLayoutProps({ schema, pageHeight });

  page.drawImage(image, { x, y, rotate, width, height, opacity });
};

const qrCodeSchema: Plugin<QRCodeSchema> = {
  pdf: pdfRender,
  ui: uiRender,
  propPanel: {
    schema: ({ i18n }: { i18n: (key: string) => string }) => ({
      barColor: {
        title: i18n('schemas.barcodes.barColor'),
        type: 'string',
        widget: 'color',
        props: {
          disabledAlpha: true,
        },
        rules: [
          {
            pattern: HEX_COLOR_PATTERN,
            message: i18n('validation.hexColor'),
          },
        ],
      },
      backgroundColor: {
        title: i18n('schemas.bgColor'),
        type: 'string',
        widget: 'color',
        props: {
          disabledAlpha: true,
        },
        rules: [
          {
            pattern: HEX_COLOR_PATTERN,
            message: i18n('validation.hexColor'),
          },
        ],
      },
    }),
    defaultSchema: {
      name: '',
      type: 'node-qrCode',
      content: 'https://pdfme.com/',
      position: { x: 0, y: 0 },
      width: 20,
      height: 20,
      backgroundColor: DEFAULT_BARCODE_BG_COLOR,
      barColor: DEFAULT_BARCODE_COLOR,
      rotate: 0,
      opacity: DEFAULT_OPACITY,
    },
  },
  icon: createSvgStr(Lucide.QrCode),
};

export default qrCodeSchema;
