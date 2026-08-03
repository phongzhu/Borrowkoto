import React from 'react';
import ReactDOM from 'react-dom/client';
import Root from './Root';
import './index.css';
import reportWebVitals from './reportWebVitals';
import GlobalStyles from './ui/GlobalStyles';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <GlobalStyles />
    <Root />
  </React.StrictMode>
);

reportWebVitals();
