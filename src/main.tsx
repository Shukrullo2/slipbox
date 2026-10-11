import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/recursive/full.css';
import '@fontsource-variable/noto-naskh-arabic/wght.css';
import './styles.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
