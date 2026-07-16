import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { FairnessView } from './components/FairnessView';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="mx-auto max-w-6xl px-4 py-6">
      <FairnessView />
    </div>
  </React.StrictMode>,
);
