with subcategory_seed(parent_name, child_name, description) as (
  values
    ('Appliances', 'Kitchen Appliances', 'Rice cookers, blenders, ovens, mixers, and other kitchen appliances.'),
    ('Appliances', 'Cleaning Appliances', 'Vacuum cleaners, steam cleaners, pressure washers, and floor-care equipment.'),
    ('Appliances', 'Cooling and Air Care', 'Electric fans, air coolers, dehumidifiers, and air purifiers.'),
    ('Appliances', 'Laundry Appliances', 'Washing, drying, ironing, and garment-care appliances.'),
    ('Appliances', 'Food and Beverage Appliances', 'Coffee makers, water dispensers, freezers, and food preparation equipment.'),
    ('Baby and Kids Items', 'Strollers and Carriers', 'Strollers, baby carriers, travel systems, and child transport gear.'),
    ('Baby and Kids Items', 'Cribs and Sleep', 'Portable cribs, bassinets, playpens, and sleep accessories.'),
    ('Baby and Kids Items', 'Kids Toys and Play', 'Educational toys, ride-ons, playsets, and indoor play equipment.'),
    ('Baby and Kids Items', 'Feeding Equipment', 'High chairs, bottle equipment, and child-safe feeding accessories.'),
    ('Baby and Kids Items', 'Kids Party Gear', 'Children party tables, costumes, inflatables, and activity equipment.'),
    ('Electronics', 'Audio and Speakers', 'Portable speakers, sound systems, microphones, and audio accessories.'),
    ('Electronics', 'Mobile Devices', 'Smartphones, tablets, power banks, and mobile accessories.'),
    ('Electronics', 'Projectors and Displays', 'Projectors, monitors, screens, televisions, and display equipment.'),
    ('Electronics', 'Networking Equipment', 'Routers, pocket Wi-Fi devices, switches, and connectivity tools.'),
    ('Electronics', 'Smart Devices', 'Smartwatches, smart-home devices, trackers, and connected gadgets.'),
    ('Fashion and Costumes', 'Formal Wear', 'Suits, gowns, formal dresses, and event attire.'),
    ('Fashion and Costumes', 'Costumes and Cosplay', 'Character costumes, themed outfits, wigs, and cosplay accessories.'),
    ('Fashion and Costumes', 'Bags and Luggage', 'Travel bags, suitcases, backpacks, and specialty cases.'),
    ('Fashion and Costumes', 'Shoes and Accessories', 'Footwear, jewelry, hats, belts, and fashion accessories.'),
    ('Fashion and Costumes', 'Traditional Attire', 'Filipiniana, Barong Tagalog, cultural clothing, and accessories.'),
    ('Gaming and Entertainment', 'Gaming Consoles', 'Home and portable gaming consoles with related equipment.'),
    ('Gaming and Entertainment', 'Controllers and Accessories', 'Controllers, racing wheels, headsets, and gaming accessories.'),
    ('Gaming and Entertainment', 'Board and Party Games', 'Board games, card games, karaoke equipment, and party games.'),
    ('Gaming and Entertainment', 'Virtual Reality', 'VR headsets, motion controllers, and virtual reality accessories.'),
    ('Gaming and Entertainment', 'Arcade and Recreation', 'Arcade machines, billiard equipment, and recreational game sets.'),
    ('Health and Wellness Equipment', 'Fitness Equipment', 'Weights, treadmills, exercise bikes, and home workout equipment.'),
    ('Health and Wellness Equipment', 'Mobility Aids', 'Wheelchairs, walkers, crutches, and mobility support equipment.'),
    ('Health and Wellness Equipment', 'Health Monitoring', 'Blood pressure monitors, oximeters, scales, and monitoring devices.'),
    ('Health and Wellness Equipment', 'Massage and Recovery', 'Massage devices, recovery tools, and relaxation equipment.'),
    ('Health and Wellness Equipment', 'Yoga and Exercise Accessories', 'Yoga mats, resistance bands, balance tools, and exercise accessories.'),
    ('Home and Living', 'Furniture', 'Tables, chairs, shelves, sofas, and temporary household furniture.'),
    ('Home and Living', 'Kitchenware and Dining', 'Cookware, serving sets, tableware, and dining accessories.'),
    ('Home and Living', 'Home Cleaning Tools', 'Manual cleaning tools, ladders, organizers, and household maintenance items.'),
    ('Home and Living', 'Decor and Event Styling', 'Decorations, backdrops, lighting accents, and event styling pieces.'),
    ('Home and Living', 'Garden and Outdoor Home', 'Garden tools, outdoor furniture, hoses, and yard equipment.'),
    ('Laptop', 'Business Laptops', 'Portable computers suitable for office, school, and productivity work.'),
    ('Laptop', 'Gaming Laptops', 'High-performance laptops for gaming, editing, and demanding applications.'),
    ('Laptop', 'Chromebooks and Budget Laptops', 'Affordable portable computers for browsing and basic productivity.'),
    ('Laptop', 'Laptop Accessories', 'Chargers, docks, cooling pads, sleeves, and external peripherals.'),
    ('Laptop', 'MacBooks', 'Apple notebook computers and compatible accessories.'),
    ('Miscellaneous', 'Party and Event Equipment', 'General event supplies, tents, tables, and crowd equipment.'),
    ('Miscellaneous', 'Travel and Outdoor Utility', 'Travel accessories, utility gear, carts, and portable storage.'),
    ('Miscellaneous', 'Educational Materials', 'Learning kits, models, reference materials, and classroom equipment.'),
    ('Miscellaneous', 'Pet Equipment', 'Pet carriers, crates, grooming equipment, and temporary pet supplies.'),
    ('Miscellaneous', 'Specialty and Collectible Items', 'Uncommon, collectible, or specialty rental items.'),
    ('Musical Instruments', 'Guitars and String Instruments', 'Guitars, ukuleles, violins, and other string instruments.'),
    ('Musical Instruments', 'Keyboards and Pianos', 'Electronic keyboards, digital pianos, stands, and pedals.'),
    ('Musical Instruments', 'Drums and Percussion', 'Drum kits, cajons, cymbals, and percussion instruments.'),
    ('Musical Instruments', 'Wind Instruments', 'Brass and woodwind instruments with related accessories.'),
    ('Musical Instruments', 'Amplifiers and Music Gear', 'Instrument amplifiers, mixers, stands, and performance accessories.'),
    ('Office Supplies', 'Printers and Scanners', 'Printers, scanners, laminators, and document equipment.'),
    ('Office Supplies', 'Presentation Equipment', 'Whiteboards, easels, clickers, screens, and presentation tools.'),
    ('Office Supplies', 'Office Furniture', 'Office chairs, desks, filing cabinets, and temporary workstations.'),
    ('Office Supplies', 'Document and Binding Tools', 'Binding machines, paper cutters, shredders, and stapling equipment.'),
    ('Office Supplies', 'School and Workshop Supplies', 'Calculators, drafting tools, teaching aids, and workshop materials.'),
    ('Photography and Videography', 'Cameras', 'DSLR, mirrorless, action, instant, and video cameras.'),
    ('Photography and Videography', 'Lenses and Filters', 'Camera lenses, optical filters, adapters, and lens accessories.'),
    ('Photography and Videography', 'Lighting Equipment', 'Studio lights, flashes, softboxes, reflectors, and light stands.'),
    ('Photography and Videography', 'Tripods and Stabilizers', 'Tripods, monopods, gimbals, sliders, and camera supports.'),
    ('Photography and Videography', 'Drones and Aerial Cameras', 'Camera drones, aerial photography gear, and accessories.'),
    ('Sports and Outdoor Gear', 'Cycling Equipment', 'Bicycles, helmets, racks, repair stands, and cycling accessories.'),
    ('Sports and Outdoor Gear', 'Camping and Hiking', 'Tents, sleeping gear, backpacks, camp furniture, and hiking equipment.'),
    ('Sports and Outdoor Gear', 'Ball Sports', 'Basketball, volleyball, football, training, and team-sport equipment.'),
    ('Sports and Outdoor Gear', 'Racket Sports', 'Badminton, tennis, table tennis, and related equipment.'),
    ('Sports and Outdoor Gear', 'Water and Adventure Sports', 'Paddle, swimming, snorkeling, and outdoor adventure equipment.')
)
insert into public.categories (name, description, parent_category_id, is_active, icon_key)
select seed.child_name, seed.description, parent.id, true, parent.icon_key
from subcategory_seed seed
join public.categories parent
  on lower(trim(parent.name)) = lower(seed.parent_name)
  and parent.parent_category_id is null
where not exists (
  select 1
  from public.categories existing
  where existing.parent_category_id = parent.id
    and lower(trim(existing.name)) = lower(seed.child_name)
);
