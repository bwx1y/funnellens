import React from 'react';
import ReferencePage from './ReferencePages.jsx';
import { ReferenceProvider } from './ReferenceContext.jsx';
import ReferenceShell from './ReferenceShell.jsx';

export default function ReferenceDashboard() {
  return <ReferenceProvider><ReferenceShell><ReferencePage /></ReferenceShell></ReferenceProvider>;
}
