-- Public marketplace read policies.
-- Run this in Supabase SQL Editor so signed-out visitors can browse rentable items.

ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_addons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view active rentable items"
ON public.items;

CREATE POLICY "Public can view active rentable items"
ON public.items
FOR SELECT
TO anon, authenticated
USING (
  is_active = true
  AND status = 'available'
);

DROP POLICY IF EXISTS "Public can view active categories"
ON public.categories;

CREATE POLICY "Public can view active categories"
ON public.categories
FOR SELECT
TO anon, authenticated
USING (
  is_active = true
);

DROP POLICY IF EXISTS "Public can view images for public items"
ON public.item_images;

CREATE POLICY "Public can view images for public items"
ON public.item_images
FOR SELECT
TO anon, authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.items i
    WHERE i.id = item_images.item_id
      AND i.is_active = true
      AND i.status = 'available'
  )
);

DROP POLICY IF EXISTS "Public can view add-ons for public items"
ON public.item_addons;

CREATE POLICY "Public can view add-ons for public items"
ON public.item_addons
FOR SELECT
TO anon, authenticated
USING (
  is_active = true
  AND EXISTS (
    SELECT 1
    FROM public.items i
    WHERE i.id = item_addons.item_id
      AND i.is_active = true
      AND i.status = 'available'
  )
);

DROP POLICY IF EXISTS "Public can view safe profile cards"
ON public.profiles;

CREATE POLICY "Public can view safe profile cards"
ON public.profiles
FOR SELECT
TO anon, authenticated
USING (
  account_status = 'active'
);

DROP POLICY IF EXISTS "Public can view reviews"
ON public.reviews;

CREATE POLICY "Public can view reviews"
ON public.reviews
FOR SELECT
TO anon, authenticated
USING (true);
