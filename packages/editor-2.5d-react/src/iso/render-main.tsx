import { createRoot } from 'react-dom/client';
import { ProcessLineSketch } from './ProcessLineSketch';

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}
createRoot(root).render(<ProcessLineSketch live={false} />);
