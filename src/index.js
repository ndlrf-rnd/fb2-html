const fs = require('fs');
const path = require('path');
const fastText = require('fasttext');
const cluster = require('cluster');

const glob = require('glob');
const {cpMap} = require('./promise.js');
const Progress = require('smooth-progress');
const IconvLite = require('iconv-lite');
const {initWorker} = require("./workers");
const {executeParallel} = require("./workers");
const {fetch} = require("./fetch");

// Language detection model
const DEFAULT_LD_MODEL_PATH = path.join(__dirname, 'models', 'lid.176.bin')

// Alternative compact version under 1MB: https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz
const DEFAULT_LD_MODEL_URL = 'https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.bin'

const DEFAULT_INPUT_GLOB = path.join(__dirname, 'input', '*.fb2')
const DEFAULT_OUTPUT_DIR = path.join(__dirname, 'output')
const UNKNOWN_LANGUAGE = 'un';
const FASTTEXT_LABEL_PREFIX = '__label__';
const ENCODING_TOKEN_START = 'encoding="'
const ENCODING_TOKEN_END = '"';
const DEFAULT_ENCODING = 'utf-8'
const HEADERS = [
  'value',
  'type',
  'file',
  'language',
  'confidence'
];


const FORCE = process.argv.indexOf('--force') !== -1;
const paths = process.argv.filter(v => !v.startsWith('-')).slice(2);

const ldModelPath = path.resolve(process.env.LD_MODEL_PATH || DEFAULT_LD_MODEL_PATH);
const ldModelUrl = process.env.LD_MODEL_URL || DEFAULT_LD_MODEL_URL;

const inputGlob = path.resolve(paths[0] || DEFAULT_INPUT_GLOB);
const outputDir = path.resolve(paths[1] || DEFAULT_OUTPUT_DIR);


/*
\p{L} or \p{Letter}: any kind of letter from any languageuage.
\p{Ll} or \p{Lowercase_Letter}: a lowercase letter that has an uppercase variant.
\p{Lu} or \p{Uppercase_Letter}: an uppercase letter that has a lowercase variant.
\p{Lt} or \p{Titlecase_Letter}: a letter that appears at the start of a word when only the first letter of the word is capitalized.
\p{L&} or \p{Cased_Letter}: a letter that exists in lowercase and uppercase variants (combination of Ll, Lu and Lt).
\p{Lm} or \p{Modifier_Letter}: a special character that is used like a letter.
\p{Lo} or \p{Other_Letter}: a letter or ideograph that does not have lowercase and uppercase variants.
\p{M} or \p{Mark}: a character intended to be combined with another character (e.g. accents, umlauts, enclosing boxes, etc.).
\p{Mn} or \p{Non_Spacing_Mark}: a character intended to be combined with another character without taking up extra space (e.g. accents, umlauts, etc.).
\p{Mc} or \p{Spacing_Combining_Mark}: a character intended to be combined with another character that takes up extra space (vowel signs in many Eastern languageuages).
\p{Me} or \p{Enclosing_Mark}: a character that encloses the character it is combined with (circle, square, keycap, etc.).
\p{Z} or \p{Separator}: any kind of whitespace or invisible separator.
\p{Zs} or \p{Space_Separator}: a whitespace character that is invisible, but does take up space.
\p{Zl} or \p{Line_Separator}: line separator character U+2028.
\p{Zp} or \p{Paragraph_Separator}: paragraph separator character U+2029.
\p{S} or \p{Symbol}: math symbols, currency signs, dingbats, box-drawing characters, etc.
\p{Sm} or \p{Math_Symbol}: any mathematical symbol.
\p{Sc} or \p{Currency_Symbol}: any currency sign.
\p{Sk} or \p{Modifier_Symbol}: a combining character (mark) as a full character on its own.
\p{So} or \p{Other_Symbol}: various symbols that are not math symbols, currency signs, or combining characters.
\p{N} or \p{Number}: any kind of numeric character in any script.
\p{Nd} or \p{Decimal_Digit_Number}: a digit zero through nine in any script except ideographic scripts.
\p{Nl} or \p{Letter_Number}: a number that looks like a letter, such as a Roman numeral.
\p{No} or \p{Other_Number}: a superscript or subscript digit, or a number that is not a digit 0�9 (excluding numbers from ideographic scripts).
\p{P} or \p{Punctuation}: any kind of punctuation character.
\p{Pd} or \p{Dash_Punctuation}: any kind of hyphen or dash.
\p{Ps} or \p{Open_Punctuation}: any kind of opening bracket.
\p{Pe} or \p{Close_Punctuation}: any kind of closing bracket.
\p{Pi} or \p{Initial_Punctuation}: any kind of opening quote.
\p{Pf} or \p{Final_Punctuation}: any kind of closing quote.
\p{Pc} or \p{Connector_Punctuation}: a punctuation character such as an underscore that connects words.
\p{Po} or \p{Other_Punctuation}: any kind of punctuation character that is not a dash, bracket, quote or connector.
\p{C} or \p{Other}: invisible control characters and unused code points.
\p{Cc} or \p{Control}: an ASCII or Latin-1 control character: 0x00�0x1F and 0x7F�0x9F.
\p{Cf} or \p{Format}: invisible formatting indicator.
\p{Co} or \p{Private_Use}: any code point reserved for private use.
\p{Cs} or \p{Surrogate}: one half of a surrogate pair in UTF-16 encoding.
\p{Cn} or \p{Unassigned}: any code point to which no character has been assigned.
Unicode
 */

// const removeTags = (body) => body
const removeTags = (body) => body
  // Preserve:
  // \p{Sm} or \p{Math_Symbol}: any mathematical symbol.
  // \p{Sc} or \p{Currency_Symbol}: any currency sign.
  .replace(/<[^>]+>/ug, '')
  .replace(/[\p{Zl}\p{Zp}\n\r]+/ug, '\n')
  .split('\n')
  .map(
    s => s.replace(/[\p{Pd}\-]+/ug, '-')
      .replace(/[\p{Ps}(]+/ug, '(')
      .replace(/[\p{Pe})]+/ug, ')')
      .replace(/[\p{Pi}«]+/ug, '«')
      .replace(/[\p{Pf}»]+/ug, '»')
      .replace(/[ \u00A0\p{Zs}\p{C}\p{Mc}\p{Me}\p{Mn}]+/ug, ' ')
      .trim()
  )
  .filter(s => s.length > 0)
  .join('\n')
// && (filterDict ? s.match(/\p{Ll}/u) && (!filterDict[s]) : true)

const extractTag = (tag, data, textCast = false) => {
  const startToken = `<${tag}>`
  const endToken = `</${tag}>`
  let bodyStart = 0;
  let bodyEnd = -1;
  const results = [];
  while (true) {
    bodyStart = data.indexOf(startToken, bodyEnd);
    if (bodyStart === -1) {
      // No new tag expected
      break
    }
    bodyStart += textCast ? startToken.length : 0;
    bodyEnd = data.indexOf(endToken, bodyStart);
    if (bodyEnd < bodyStart) {
      bodyEnd = data.length
    } else {
      if (!textCast) {
        bodyEnd += endToken.length
      }
    }
    results.push(data.substr(bodyStart, bodyEnd - bodyStart));
  }

  return results
    .map(s => (textCast ? removeTags(s) : s).trim())
    .filter(s => s.length > 0)
}

const cutTag = (tag, data) => {
  const startToken = `<${tag}>`
  const endToken = `</${tag}>`
  let tagStartPos = -1;
  let tagPrevEndPos = 0;
  const results = [];
  while (true) {
    tagStartPos = data.indexOf(startToken, tagPrevEndPos);
    if (tagStartPos === -1) {
      // No new tag expected
      results.push(data.substr(tagPrevEndPos))
      break
    }

    if (tagPrevEndPos < tagStartPos) {
      results.push(data.substr(tagPrevEndPos, tagStartPos - tagPrevEndPos));
    }
    tagPrevEndPos = data.indexOf(endToken, tagStartPos);
    if (tagPrevEndPos !== -1) {
      tagPrevEndPos += endToken.length
    }
  }

  return results.map(s => s.trim()).filter(s => s.length > 0).join('\n')
}

let Classifier = null;

const getLanguage = async (text) => {
  if (!Classifier) {
    Classifier = new fastText.Classifier();
    if (!fs.existsSync(ldModelPath))  {
      process.stderr.write(`WARNING: No language detection model was found at: ${ldModelPath}.\nLanguage detection will be executed in shallow mode.\n`); 
      return {language: null, confidence: 0.0};
    }
    await Classifier.loadModel(ldModelPath);
  }
  const langs = await Classifier.predict(text.replace(/[\n\r\t ]+/ug, ' '), 5);
  const language = (
    langs[0]
      ? langs[0].label.replace(FASTTEXT_LABEL_PREFIX, '')
      : UNKNOWN_LANGUAGE
  ).toLowerCase();
  const confidence = langs[0] ? langs[0].value : 0;
  return {language, confidence}
}
const getFb2Encoding = data => {
  const start = data.indexOf(ENCODING_TOKEN_START)
  if (start === -1) {
    return DEFAULT_ENCODING
  }
  const startTokenEnd = start + ENCODING_TOKEN_START.length;
  const end = data.indexOf(ENCODING_TOKEN_END, startTokenEnd);
  return data.slice(startTokenEnd, end) || DEFAULT_ENCODING
}

const processFile = async (file, {force}) => {

  const bn = path.join(outputDir, `${path.basename(file, path.extname(file))}`)

  const outputTsvPath = `${bn}.tsv`
  const outputMetadataPath = `${bn}.xml`

  if (!fs.existsSync(file)) {
    throw new Error(`Input file does not exists: ${file}`);
  }
  if ((!force) && fs.existsSync(outputMetadataPath) && fs.existsSync(outputTsvPath)) {
    return null;
  } else {
    return new Promise(
      (resolve) => {
        let stream = fs.createReadStream(file)//.pipe(ds);
        let data = [];
        stream.on('data', chunk => {
          data.push(chunk);
        }).on(
          'end',
          async () => {
            // Metadata
            data = Buffer.concat(data)
            const encoding = getFb2Encoding(data);
            data = IconvLite.decode(data, encoding);
            const metadata = extractTag('description', data, false).join('\n');
            fs.writeFileSync(outputMetadataPath, metadata, 'utf-8')

            // Text and language detection
            let body = extractTag('body', data, false).join('\n');


            let resTsv = [
              HEADERS.reduce((a, k) => ({...a, [k]: k}), {})
            ]

            // Tables
            resTsv = [
              ...resTsv,
              ...extractTag('table', body, false).map(
                (value) => ({value, type: 'table'})
              )
            ]
            body = cutTag('table', body)

            resTsv = [
              ...resTsv,
              ...extractTag('epigraph', body, true).map(
                (value) => ({value, type: 'epigraph'})
              )
            ];
            body = cutTag('epigraph', body)

            resTsv = [
              ...resTsv,
              ...extractTag('poem', body, true).map(
                (value) => ({value, type: 'poem'})
              )
            ]
            body = cutTag('poem', body)

            resTsv = [
              ...resTsv,
              ...extractTag('cite', body, true).map(
                (value) => ({value, type: 'cite'})
              )
            ]
            body = cutTag('cite', body)

            // Titles
            resTsv = [
              ...resTsv,
              ...extractTag('title', body, true).map(
                (value) => ({value, type: 'title'})
              )
            ]
            body = cutTag('title', body)

            resTsv = [
              ...resTsv,
              ...extractTag('subtitle', body, true).map(
                (value) => ({value, type: 'subtitle'})
              )
            ]
            body = cutTag('subtitle', body)

            // Paragraphs
            resTsv = [
              ...resTsv,
              ...extractTag('p', body, true).map(
                (value) => ({value, type: 'text'})
              )
            ]

            const sanitizedResTsv = await cpMap(
              resTsv,
              async ({value, ...kwargs}, idx) => {
                const isHeader = idx === 0;
                const sanitizedValue = isHeader ? value : value.replace(/[ ]*[\n\r\t]+[ ]*/uig, ' ');
                const sanitizedFilePath = path.relative(process.cwd(), file)
                let lang = {language: UNKNOWN_LANGUAGE, confidence: 0.0}
                if (ldModelPath) {
                  lang = await getLanguage(sanitizedValue, ldModelPath);
                }
                return {
                  value: sanitizedValue,
                  file: sanitizedFilePath,
                  ...lang,
                  ...kwargs,
                }
              }
            );
            const resTsvStr = sanitizedResTsv.map(
              o => HEADERS.map(k => o[k]).join('\t')
            ).join('\n');

            fs.writeFileSync(outputTsvPath, resTsvStr, 'utf-8');
            resolve(outputTsvPath);
          }
        )
      }
    )
  }
}
const processFiles = async (files, ctx, workerId) => {
  let failed = 0;
  let ignored = 0;
  let processed = 0;
  const pb = Progress({
    tmpl: '[:workerId] Processing :bar :percent :eta    :done / :total (:success OK + :failed failed + :ignored ignored)    :p',
    width: 13,
    total: files.length
  });
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir)
  }

  return cpMap(
    files,
    async file => {
      try {
        const res = await processFile(file, ctx);
        if (res === null) {
          ignored += 1;
        } else {
          processed += 1;
        }
      } catch (e) {
        failed += 1;
      }

      process.stderr.cursorTo(0, workerId + 2);
      pb.tick(1, {
        p: path.relative(__dirname, file),
        total: files.length,
        done: processed + failed + ignored,
        failed: failed,
        ignored: ignored,
        success: processed,
        workerId,
      });
      process.stderr.cursorTo(0, global.JOBS + 3);
    }
  )
};


process.on('exit', (code) => {
  console.clear();
});


initWorker({
  processFiles
})

if (cluster.isMaster) {
  console.clear();
  glob.glob(
    inputGlob,
    {},
    (err, files) => {
      process.stderr.write(`INPUT:\t${inputGlob}\t${files.length} matching files\n`);
      process.stderr.write(`OUTPUT:\t${outputDir}\n`);
      new Promise((resolve, reject) => {
        if (!fs.existsSync(ldModelPath)) {
          if (ldModelUrl) {
            process.stderr.write(`Downloading language detection model ${ldModelUrl} --> ${ldModelPath} ...`);
            fetch(ldModelUrl, ldModelPath).catch((err) => {
              reject(err);
            }).then(() => {
              process.stderr.write('Done!\n');
              resolve();
            });
          } else {
            process.stderr.write(`WARNING: No language detection model was found at: ${ldModelPath}.\nLanguage detection will be executed in shallow mode.\n`);
            resolve();
          }
       } else {
         resolve();
       }
     }).then(() => {
      return executeParallel(
        'processFiles',
        files,
        {force: FORCE}
      ).catch(e => {
        console.error(e);
        process.exit(-1)
      }).then(() => {
        process.exit(0);
      });
    });
  });
}
