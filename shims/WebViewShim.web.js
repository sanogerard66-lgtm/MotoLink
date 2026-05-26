import React from 'react';
export default function WebView({ srcDoc, style }) {
  return <iframe srcDoc={srcDoc} style={{ border:'none', ...style }} />;
}
