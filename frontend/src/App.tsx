import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminShell } from './features/admin/AdminShell';
import { ActivitiesPage } from './features/admin/activities/ActivitiesPage';
import { EditActivityPage } from './features/admin/edit/EditActivityPage';
import { ManagePhotosPage } from './features/admin/photos/ManagePhotosPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AdminShell />}>
          <Route index element={<Navigate to="/activities" replace />} />
          <Route path="/activities" element={<ActivitiesPage />} />
          <Route path="/activities/new" element={<EditActivityPage />} />
          <Route path="/activities/:id/edit" element={<EditActivityPage />} />
          <Route path="/activities/:id/photos" element={<ManagePhotosPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
