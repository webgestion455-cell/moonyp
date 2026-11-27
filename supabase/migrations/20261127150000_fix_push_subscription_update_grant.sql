-- Allow an authenticated user to refresh their own existing Web Push endpoint.
grant update on table public.push_subscriptions to authenticated;
