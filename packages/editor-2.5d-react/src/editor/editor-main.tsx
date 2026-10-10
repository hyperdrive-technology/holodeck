import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PROCESS_SCENE } from '../iso/load-process-scene';
import { ProcessEditor } from './ProcessEditor';

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}

function Host() {
  const [scene, setScene] = useState(PROCESS_SCENE);
  return <ProcessEditor scene={scene} onChange={setScene} mode="edit" />;
}

createRoot(root).render(<Host />);
