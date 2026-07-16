import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AdminShell } from './features/admin/AdminShell';
import { ActivitiesPage } from './features/admin/activities/ActivitiesPage';
import { EditActivityPlaceholder } from './features/admin/EditActivityPlaceholder';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AdminShell />}>
          <Route index element={<Navigate to="/activities" replace />} />
          <Route path="/activities" element={<ActivitiesPage />} />
          <Route path="/activities/new" element={<EditActivityPlaceholder />} />
          <Route
            path="/activities/:id/edit"
            element={<EditActivityPlaceholder />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
