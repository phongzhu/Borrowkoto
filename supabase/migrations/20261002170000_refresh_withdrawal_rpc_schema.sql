-- Refresh the API schema cache so admin and owner withdrawal RPCs resolve immediately.
notify pgrst, 'reload schema';
