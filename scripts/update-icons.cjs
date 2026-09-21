const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pngPath = path.join(root, 'icons/icon-512.png');
const b64 = fs.readFileSync(pngPath).toString('base64');

// 루트에 복사 (iOS 및 웹 서버 루트 탐색 대응)
fs.copyFileSync(path.join(root, 'icons/icon-180.png'), path.join(root, 'apple-touch-icon.png'));
fs.copyFileSync(path.join(root, 'icons/icon-180.png'), path.join(root, 'apple-touch-icon-precomposed.png'));

// SVG 파일 업데이트
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <clipPath id="squircle">
      <rect width="512" height="512" rx="112" ry="112"/>
    </clipPath>
  </defs>
  <rect width="512" height="512" rx="112" ry="112" fill="#222b38"/>
  <image width="512" height="512" clip-path="url(#squircle)" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/png;base64,${b64}" href="data:image/png;base64,${b64}"/>
</svg>
`;

fs.writeFileSync(path.join(root, 'icon.svg'), svg, 'utf8');
console.log('Successfully updated icon.svg and root apple-touch-icon.png files.');
