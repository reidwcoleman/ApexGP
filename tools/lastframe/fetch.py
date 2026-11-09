#!/usr/bin/env python3
"""Downloads the CC0 Poly Haven source assets for Last Frame into assets-src/lf (git-ignored)."""
import json, os, sys, urllib.request, concurrent.futures as cf
ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets-src', 'lf')
UA = {'User-Agent': 'apexgp-asset-fetch'}
TEX = '''asphalt_02 clean_asphalt concrete_pavement_02 factory_brick dark_brick_wall brick_wall_001 concrete_wall_006 concrete_wall_008
corrugated_iron_02 box_profile_metal_sheet beige_wall_001 damaged_plaster decrepit_wallpaper grey_plaster linoleum_brown dirty_carpet laminate_floor_02
garage_floor concrete_floor_worn_001 dirty_tiles metal_grate_rusty metal_plate green_metal_rust distressed_painted_planks gravel_concrete blue_plaster_weathered
hangar_concrete_floor'''.split()
MODELS = '''wooden_crate_01 wooden_crate_02 metal_trash_can trashbag cardboard_box_01 steel_frame_shelves_01 steel_frame_shelves_02 steel_frame_shelves_03
metal_office_desk drawer_cabinet sofa_03 old_bed_frame plastic_monobloc_chair_01 SchoolChair_01 vintage_cabinet_01 fire_hydrant concrete_road_barrier covered_car
street_lamp_01 street_lamp_02 exterior_aircon_unit utility_box_01 utility_box_02 power_box_01 propane_tank portable_generator barrel_03 metal_jerrycan old_tyre
mounted_fluorescent_lights hanging_industrial_lamp industrial_wall_lamp security_light rollershutter_door modular_chainlink_fence modular_fire_escape
modular_industrial_pipes_01 modular_airduct_rectangular_01 ladder_sectioned_01 tool_cart hand_truck plastic_crate_01 television_02 WetFloorSign_01 fire_alarm
water_manhole_cover korean_fire_extinguisher_01 service_pistol bolt_action_rifle_7_62 ammo_box wooden_military_crate worn_metal_rack wooden_table_02 painted_wooden_chair_01
modular_electric_cables security_camera_01 cement_bag multi_cleaner_5_litre
modular_urban_apartments_facade modular_factory_facade modular_electricity_poles modular_street_seating concrete_road_barrier_02 korean_public_payphone_01 modular_metal_gutter
rollershutter_window_01 rollershutter_window_02 rollershutter_window_03 modular_pipes modular_airduct_circular_01 overhead_crane security_camera_02 industrial_wall_sconce industrial_caged_sconce
caged_hanging_light ceiling_fan pull_chain_light_socket industrial_pipe_lamp Sofa_01 ArmChair_01 CoffeeTable_01 Shelf_01 Television_01 dining_table dining_chair_02 WoodenTable_01 WoodenChair_01
bar_chair_round_01 metal_stool_01 metal_stool_02 wooden_stool_01 side_table_01 wooden_bookshelf_worn painted_wooden_shelves modern_wooden_cabinet SchoolDesk_01 ClassicNightstand_01
hanging_picture_frame_01 hanging_picture_frame_02 hanging_picture_frame_03 wall_clock fancy_picture_frame_01 ornate_mirror_01 potted_plant_01 potted_plant_02 potted_plant_04 dartboard
electric_stove vintage_microwave CashRegister_01 wine_bottles_01 russian_food_cans_01 long_life_food plastic_bottle_gallon can_rusted pot_enamel_01 brass_pan_01 wooden_cutting_board CoffeeCart_01 BarberShopChair_01
metal_tool_chest metal_toolbox drill_press_01 old_drill_press bench_vice_01 portable_welding_cart industrial_storage_cart plastic_crate_02 plastic_crate_03 plastic_jerrycan metal_jerrycan_green small_lpg_tank oil_tin
old_military_crate old_military_compressor compost_bags industrial_pastic_container plastic_container wooden_ladder portable_searchlight tire_pump planter_box_01 planter_box_02 tree_small_02 dead_tree_trunk shrub_01
weed_plant_02 moss_01 street_rat tree_stump_01 wooden_picnic_table outdoor_table_chair_set_01 garden_hose_wall_mounted_01 classic_laptop desk_lamp_arm_01 clipboard binder_notebook office_notepads medical_box wheelchair_01
projector_screen standing_chalkboard_01 boombox vintage_suitcase'''.split()
HDRI = ['dresden_station_night', 'modern_buildings_night', 'rooftop_night', 'cobblestone_street_night', 'kloofendal_overcast_puresky']
# the cove: a Cornish fishing village
TEX += '''cliff_side coast_land_rocks_01 coast_sand_rocks_02 coast_sand_01 damp_beach_sand low_tide_rocks dark_rock mossy_rock leafy_grass grass_path_2
grey_roof_tiles castle_wall_slates mossy_stone_wall cobblestone_floor_04 clay_plaster large_pebbles'''.split()
MODELS += '''coast_rocks_01 coast_rocks_02 coast_rocks_03 coast_rocks_05 coast_land_rocks_02 coast_land_rocks_03 coast_land_rocks_04 rock_face_01 rock_face_02
rock_moss_set_01 rock_moss_set_02 shrub_01 shrub_02 shrub_03 shrub_04 fern_02 grass_medium_01 grass_medium_02 nettle_plant pine_tree_01 tree_small_02
ocean_buoy lifebuoy modular_wooden_pier painted_wooden_bench wooden_barrels_01 street_lamp_01 planter_box_01'''.split()

# the cove in sunlight: render, real slate, dry stone, sea rock, a boat worth looking at
TEX += '''white_plaster_rough_01 painted_plaster_wall worn_plaster_wall roof_slates_02 roof_slates_03 stacked_stone_wall rustic_stone_wall
seaside_rock lichen_rock rock_wall_10 worn_asphalt clean_pebbles blue_painted_planks green_rough_planks'''.split()
MODELS += '''wooden_bucket_01 planter_pot_clay wooden_ladder_02 stone_01 dandelion_01 shrub_sorrel_01 flower_gazania wooden_lantern_01 fishermans_hat'''.split()
HDRI += ['kloofendal_48d_partly_cloudy_puresky']


# the ward
TEX += '''square_tiled_wall long_white_tiles peeling_painted_wall old_linoleum_flooring_01 worn_tile_floor dirty_concrete'''.split()

def get(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0: return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120)
    with open(path + '.part', 'wb') as f: f.write(r.read())
    os.replace(path + '.part', path)

def files(a):
    return json.load(urllib.request.urlopen(urllib.request.Request('https://api.polyhaven.com/files/' + a, headers=UA), timeout=60))

# what fills the screen most comes at 2k, colour and normals; pack.py prefers these
HERO = '''asphalt_02 clean_asphalt concrete_pavement_02 factory_brick dark_brick_wall brick_wall_001 gravel_concrete hangar_concrete_floor
concrete_floor_worn_001 blue_plaster_weathered decrepit_wallpaper damaged_plaster grey_plaster corrugated_iron_02 concrete_wall_008
cliff_side coast_land_rocks_01 coast_sand_rocks_02 damp_beach_sand leafy_grass grey_roof_tiles clay_plaster castle_wall_slates cobblestone_floor_04
white_plaster_rough_01 roof_slates_02 roof_slates_03 stacked_stone_wall seaside_rock worn_asphalt clean_pebbles
square_tiled_wall long_white_tiles peeling_painted_wall old_linoleum_flooring_01 worn_tile_floor'''.split()


# the mansion
TEX += """herringbone_parquet old_wood_floor marble_tiles patterned_plaster_wall worn_cracked_plaster rough_plaster_broken red_plaster_weathered
stone_tiles_02 castle_brick_07 dark_wooden_planks wood_plank_wall""".split()
HERO += """herringbone_parquet marble_tiles patterned_plaster_wall""".split()
MODELS += """Chandelier_01 Chandelier_02 GothicBed_01 GothicCabinet_01 GothicCommode_01 Rockingchair_01 ClassicConsole_01 vintage_grandfather_clock_01
Ottoman_01 fancy_picture_frame_02 vintage_wooden_drawer_01 antique_ceramic_vase_01 brass_candleholders gothic_coffee_table vintage_day_bed wooden_candlestick
painted_wooden_sofa side_table_tall_01""".split()

def tex(a):
    d = files(a)
    out = []
    for res, dst, keys in (('1k', 'tex', (('Diffuse', 'diff'), ('nor_gl', 'nor'), ('arm', 'arm'))), ('2k', 'tex2k', (('Diffuse', 'diff'), ('nor_gl', 'nor')))):
        if dst == 'tex2k' and a not in HERO: continue
        for k, n in keys:
            if k in d and res in d[k]:
                fm = d[k][res]
                f = fm.get('jpg') or fm.get('png')
                get(f['url'], f'{ROOT}/{dst}/{a}_{n}.jpg'); out.append(n)
    return a, out

def model(a):
    d = files(a); g = d['gltf']['1k']['gltf']
    base = f'{ROOT}/models/{a}'
    get(g['url'], f'{base}/{a}.gltf')
    for rel, m in g['include'].items(): get(m['url'], f'{base}/{rel}')
    return a, 'ok'

def hdri(a):
    d = files(a); get(d['hdri']['4k' if 'partly' in a else '2k']['hdr']['url'], f'{ROOT}/hdri/{a}.hdr'); return a, 'ok'

jobs = [(tex, a) for a in TEX] + [(model, a) for a in MODELS] + [(hdri, a) for a in HDRI]
bad = 0
with cf.ThreadPoolExecutor(8) as ex:
    fs = {ex.submit(f, a): a for f, a in jobs}
    for f in cf.as_completed(fs):
        try: f.result()
        except Exception as e: bad += 1; print('FAIL', fs[f], e)
print('done', len(jobs), 'bad', bad)
