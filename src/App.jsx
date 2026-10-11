import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import LegacyApp from './pages/LegacyApp.jsx';
import { ApiStatus } from './pages/ApiStatus.jsx';
import DataCenter from './pages/DataCenter.jsx';

export default function App() {
  return <Routes>
    <Route path="/" element={<LegacyApp />} />
    <Route path="/migration-status" element={<ApiStatus />} />
    <Route path="/data-center" element={<DataCenter />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
