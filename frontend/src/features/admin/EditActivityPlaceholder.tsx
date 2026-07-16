import { Link, useParams } from 'react-router-dom';

/** Navigation seam for T4 — the row Edit button and "New activity" already
 * route here for real; T4 fills in the actual edit/create form. */
export function EditActivityPlaceholder() {
  const { id } = useParams();

  return (
    <div className="admin-page">
      <p>
        <Link to="/activities">← Back to Activities</Link>
      </p>
      <h1>{id ? `Edit activity ${id}` : 'New activity'}</h1>
      <p>Coming in T4.</p>
    </div>
  );
}
