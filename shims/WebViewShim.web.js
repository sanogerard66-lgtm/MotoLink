import React from 'react';
export default function WebView({ srcDoc, source, style }) {
  const html = srcDoc || (source && source.html) || '';
  return (
    <iframe
      srcDoc={html}
      src={source && source.uri}
      style={{ border: 'none', width: '100%', height: '100%', ...style }}
      title="map"
    />
  );
}
