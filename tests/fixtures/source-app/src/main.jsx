import { loadApp } from '@intenda/opus-ui';
import './main.css';

const res = await fetch('/app.json');
const mdaPackage = await res.json();

loadApp({
	mdaPackage,
	env: import.meta.env.VITE_APP_MODE
});