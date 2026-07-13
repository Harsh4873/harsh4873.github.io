import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { Dataset } from './lib/types';
import { loadDataset } from './lib/dataset';
import { useRoute } from './lib/router';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Browser } from './pages/Browser';
import { GeneDetail } from './pages/GeneDetail';
import { Compare } from './pages/Compare';
import { Datasets } from './pages/Datasets';
import { About } from './pages/About';

export default function App() {
  const route = useRoute();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadDataset()
      .then((d) => alive && setDataset(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.path, route.params.id]);

  if (error) {
    return (
      <div className="center-screen">
        <TriangleAlert size={30} style={{ color: 'var(--danger)' }} />
        <div>Couldn't load the gene catalog.</div>
        <div className="dim" style={{ fontSize: 13 }}>{error}</div>
      </div>
    );
  }

  if (!dataset) {
    return (
      <div className="center-screen">
        <div className="spinner" />
        <div>Loading the H37Rv genome…</div>
      </div>
    );
  }

  let page: React.ReactNode;
  switch (route.path) {
    case 'browse':
      page = <Browser dataset={dataset} />;
      break;
    case 'gene':
      page = <GeneDetail dataset={dataset} orf={route.params.id ?? ''} />;
      break;
    case 'compare':
      page = <Compare dataset={dataset} />;
      break;
    case 'datasets':
      page = <Datasets dataset={dataset} />;
      break;
    case 'about':
      page = <About />;
      break;
    default:
      page = <Home dataset={dataset} />;
  }

  return <Layout genes={dataset.genes}>{page}</Layout>;
}
