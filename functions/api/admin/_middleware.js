// Second lock on the admin API. It runs for every route in this folder however the URL is
// spelled, so access never depends on the path check in ../_middleware.js alone.
import { fail } from '../_util.js';

export const onRequest = ({ data, next }) => (data.user?.is_admin ? next() : fail('Only admins can do that', 403));
