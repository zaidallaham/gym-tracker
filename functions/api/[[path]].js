// Any /api/* path without its own route. Without this, Pages would answer with index.html.
import { fail } from './_util.js';

export const onRequest = () => fail('Not found', 404);
