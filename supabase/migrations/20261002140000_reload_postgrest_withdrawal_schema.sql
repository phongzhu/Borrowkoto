-- Make the new earnings withdrawal RPCs visible to the PostgREST schema cache.
notify pgrst, 'reload schema';
