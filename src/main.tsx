import './streamPolyfill';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyTheme, loadTheme } from './theme';

// Theme synchron vor dem ersten Render setzen — kein Flackern beim Start.
applyTheme(loadTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
