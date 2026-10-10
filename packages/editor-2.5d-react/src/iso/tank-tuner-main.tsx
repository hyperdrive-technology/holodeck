import { createRoot } from 'react-dom/client';
import { TankTuner } from './TankTuner';

const root = document.getElementById('root');
if (!root) {
  throw new Error('missing #root');
}
createRoot(root).render(<TankTuner />);
