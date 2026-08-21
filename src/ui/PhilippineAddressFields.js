import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, FormField, Input, StatusMessage } from './primitives';
import SearchableSelect from './SearchableSelect';
import { alpha, theme } from './theme';
import { buildAddressQuery, buildMapEmbedUrl, geocodePhilippineAddress, sanitizeText } from './profileFormUtils';

const PSGC_BASE_URL = 'https://psgc.gitlab.io/api';
const FIXED_LOCATION = {
  cityAliases: ['baliwag', 'baliuag', 'city of baliwag'],
  cityCanonical: 'City of Baliwag',
  country: 'Philippines',
  province: 'Bulacan',
  regionAliases: ['region iii', 'central luzon'],
  regionCanonical: 'Region III (Central Luzon)',
};

const selectStyle = {
  background: alpha(theme.colors.panel, 0.92),
  border: `1px solid ${alpha(theme.colors.ink, 0.1)}`,
  borderRadius: 18,
  color: theme.colors.ink,
  fontFamily: theme.fonts.body,
  fontSize: 15,
  minHeight: 52,
  outline: 'none',
  padding: '0 16px',
  width: '100%',
};

const defaultFieldMap = {
  barangay: 'barangay',
  city: 'city',
  country: 'country',
  latitude: 'latitude',
  longitude: 'longitude',
  province: 'province',
  region: 'region',
  street: 'street',
};

const defaultLabels = {
  barangay: 'Barangay',
  city: 'City / Municipality',
  country: 'Country',
  mapDescription: 'Search for your address or use your current location to place the map pin accurately.',
  mapTitle: 'Map location',
  province: 'Province',
  region: 'Region',
  search: 'Search place',
  searchPlaceholder: 'Search a place in the Philippines',
  street: 'Street',
  useProfileAddress: 'Use my saved profile address',
};

function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function matchesAnyAlias(value, aliases) {
  const normalizedValue = normalize(value);
  return aliases.some((alias) => normalizedValue === alias || normalizedValue.includes(alias));
}

function getRegionLabel(region) {
  if (!region) {
    return '';
  }

  if (region.name === 'NCR' && region.regionName) {
    return `${region.regionName} (${region.name})`;
  }

  return region.name;
}

function findByName(options, value, labelBuilder) {
  const normalizedValue = normalize(value);

  return options.find((option) => {
    const optionName = normalize(option.name);
    const optionLabel = normalize(labelBuilder ? labelBuilder(option) : option.name);
    return optionName === normalizedValue || optionLabel === normalizedValue;
  });
}

function normalizeBarangayName(value) {
  return normalize(value)
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(?:barangay|brgy)\.?\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function findBarangayByName(options, value) {
  const normalizedValue = normalizeBarangayName(value);
  return options.find((option) => normalizeBarangayName(option.name) === normalizedValue);
}

function readValue(form, fieldMap, key) {
  const fieldName = fieldMap[key];
  return fieldName ? form?.[fieldName] || '' : '';
}

function createMappedFields(fieldMap, nextFields) {
  return Object.entries(nextFields).reduce((mapped, [key, value]) => {
    const fieldName = fieldMap[key];

    if (fieldName) {
      mapped[fieldName] = value;
    }

    return mapped;
  }, {});
}

function getAddressPart(address, keys) {
  return keys.map((key) => sanitizeText(address?.[key])).find(Boolean) || '';
}

function extractAddressFields(result) {
  const address = result?.address || {};
  const street = [sanitizeText(address.house_number), sanitizeText(address.road)].filter(Boolean).join(' ');

  return {
    barangay: getAddressPart(address, ['suburb', 'quarter', 'neighbourhood', 'hamlet', 'village', 'city_district', 'district']),
    city: getAddressPart(address, ['city', 'town', 'municipality', 'village']),
    country: getAddressPart(address, ['country']) || 'Philippines',
    latitude: result?.latitude || '',
    longitude: result?.longitude || '',
    province: getAddressPart(address, ['state_district', 'province']),
    region: getAddressPart(address, ['region', 'state']),
    street,
  };
}

function isBaliwagLocation(result) {
  const address = result?.address || {};
  const city = getAddressPart(address, ['city', 'town', 'municipality', 'village']);
  const province = getAddressPart(address, ['state_district', 'province']);
  const region = getAddressPart(address, ['region', 'state']);
  const label = sanitizeText(result?.label);
  const cityMatch = matchesAnyAlias(city, FIXED_LOCATION.cityAliases) || matchesAnyAlias(label, FIXED_LOCATION.cityAliases);
  const provinceMatch = normalize(province) === normalize(FIXED_LOCATION.province) || normalize(label).includes(normalize(FIXED_LOCATION.province));
  const regionMatch =
    !region ||
    matchesAnyAlias(region, FIXED_LOCATION.regionAliases) ||
    FIXED_LOCATION.regionAliases.some((alias) => normalize(label).includes(alias));

  return cityMatch && provinceMatch && regionMatch;
}

async function fetchPSGC(path) {
  const response = await fetch(`${PSGC_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Address source error (${response.status})`);
  }

  return response.json();
}

export default function PhilippineAddressFields({
  columnCount = 2,
  fieldMap = defaultFieldMap,
  flatMap = false,
  form,
  labels: labelOverrides = {},
  profileSource = null,
  requiredFields = [],
  setForm,
  showCoordinates = true,
  showUseProfileAddress = false,
}) {
  const labels = { ...defaultLabels, ...labelOverrides };
  const requiredFieldSet = useMemo(() => new Set(requiredFields), [requiredFields]);
  const addressGridStyle = { display: 'grid', gap: 14, gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` };
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [barangays, setBarangays] = useState([]);
  const [addressError, setAddressError] = useState('');
  const [regionHasDirectCities, setRegionHasDirectCities] = useState(false);
  const [loadingRegions, setLoadingRegions] = useState(true);
  const [loadingProvinces, setLoadingProvinces] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingBarangays, setLoadingBarangays] = useState(false);
  const [locationBusy, setLocationBusy] = useState('');
  const [locationMessage, setLocationMessage] = useState('');
  const [locationTone, setLocationTone] = useState('info');
  const [locationSearch, setLocationSearch] = useState('');
  const [useProfileAddress, setUseProfileAddress] = useState(false);

  const updateAddressFields = useCallback((nextFields) => {
    setForm((current) => ({
      ...current,
      ...createMappedFields(fieldMap, nextFields),
    }));
  }, [fieldMap, setForm]);

  useEffect(() => {
    let mounted = true;

    async function loadRegions() {
      try {
        const regionData = await fetchPSGC('/regions/');

        if (!mounted) {
          return;
        }

        setRegions(regionData || []);
        setAddressError('');
      } catch (loadError) {
        if (!mounted) {
          return;
        }

        setAddressError(`Unable to load Philippine address options: ${loadError.message}`);
      } finally {
        if (mounted) {
          setLoadingRegions(false);
        }
      }
    }

    loadRegions();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setForm((current) => ({
      ...current,
      [fieldMap.country]: FIXED_LOCATION.country,
      [fieldMap.province]: FIXED_LOCATION.province,
      [fieldMap.region]: FIXED_LOCATION.regionCanonical,
    }));
  }, [fieldMap.country, fieldMap.province, fieldMap.region, setForm]);

  useEffect(() => {
    if (!readValue(form, fieldMap, 'country')) {
      setForm((current) => ({
        ...current,
        [fieldMap.country]: 'Philippines',
      }));
    }
  }, [fieldMap.country, fieldMap, form, setForm]);

  const selectedRegion = useMemo(() => findByName(regions, readValue(form, fieldMap, 'region'), getRegionLabel), [fieldMap, form, regions]);
  const selectedProvince = useMemo(() => findByName(provinces, readValue(form, fieldMap, 'province')), [fieldMap, form, provinces]);
  const selectedCity = useMemo(() => findByName(cities, readValue(form, fieldMap, 'city')), [cities, fieldMap, form]);
  const savedBarangay = readValue(form, fieldMap, 'barangay');
  const selectedBarangay = useMemo(() => findBarangayByName(barangays, savedBarangay), [barangays, savedBarangay]);
  const barangayOptions = useMemo(() => {
    const options = barangays.map((barangay) => ({ label: barangay.name, value: barangay.code }));

    if (savedBarangay && !selectedBarangay) {
      options.unshift({ label: savedBarangay, value: '__saved_barangay__' });
    }

    return options;
  }, [barangays, savedBarangay, selectedBarangay]);
  const mapUrl = useMemo(() => buildMapEmbedUrl(readValue(form, fieldMap, 'latitude'), readValue(form, fieldMap, 'longitude')), [fieldMap, form]);
  const fixedRegion = useMemo(
    () => regions.find((region) => matchesAnyAlias(getRegionLabel(region), FIXED_LOCATION.regionAliases)),
    [regions]
  );
  const fixedProvince = useMemo(
    () => provinces.find((province) => normalize(province.name) === normalize(FIXED_LOCATION.province)),
    [provinces]
  );
  const fixedCity = useMemo(
    () =>
      cities.find((city) => matchesAnyAlias(city.name, FIXED_LOCATION.cityAliases)) ||
      cities.find((city) => normalize(city.name) === normalize(FIXED_LOCATION.cityCanonical)),
    [cities]
  );

  useEffect(() => {
    let mounted = true;

    async function loadRegionDependents() {
      setProvinces([]);
      setCities([]);
      setBarangays([]);
      setRegionHasDirectCities(false);

      if (!selectedRegion) {
        return;
      }

      setLoadingProvinces(true);

      try {
        const provinceData = await fetchPSGC(`/regions/${selectedRegion.code}/provinces/`);

        if (!mounted) {
          return;
        }

        if (provinceData?.length) {
          setProvinces(provinceData);
          setAddressError('');
        } else {
          const cityData = await fetchPSGC(`/regions/${selectedRegion.code}/cities-municipalities/`);

          if (!mounted) {
            return;
          }

          setRegionHasDirectCities(true);
          setCities(cityData || []);
          setAddressError('');
        }
      } catch (loadError) {
        if (!mounted) {
          return;
        }

        setAddressError(`Unable to load region address options: ${loadError.message}`);
      } finally {
        if (mounted) {
          setLoadingProvinces(false);
        }
      }
    }

    loadRegionDependents();

    return () => {
      mounted = false;
    };
  }, [selectedRegion]);

  useEffect(() => {
    let mounted = true;

    async function loadCities() {
      if (!selectedProvince || regionHasDirectCities) {
        return;
      }

      setCities([]);
      setBarangays([]);
      setLoadingCities(true);

      try {
        const cityData = await fetchPSGC(`/provinces/${selectedProvince.code}/cities-municipalities/`);

        if (!mounted) {
          return;
        }

        setCities(cityData || []);
        setAddressError('');
      } catch (loadError) {
        if (!mounted) {
          return;
        }

        setAddressError(`Unable to load cities and municipalities: ${loadError.message}`);
      } finally {
        if (mounted) {
          setLoadingCities(false);
        }
      }
    }

    loadCities();

    return () => {
      mounted = false;
    };
  }, [regionHasDirectCities, selectedProvince]);

  useEffect(() => {
    let mounted = true;

    async function loadBarangays() {
      setBarangays([]);

      if (!selectedCity) {
        return;
      }

      setLoadingBarangays(true);

      try {
        const barangayData = await fetchPSGC(`/cities-municipalities/${selectedCity.code}/barangays/`);

        if (!mounted) {
          return;
        }

        setBarangays(barangayData || []);
        setAddressError('');
      } catch (loadError) {
        if (!mounted) {
          return;
        }

        setAddressError(`Unable to load barangays: ${loadError.message}`);
      } finally {
        if (mounted) {
          setLoadingBarangays(false);
        }
      }
    }

    loadBarangays();

    return () => {
      mounted = false;
    };
  }, [selectedCity]);

  useEffect(() => {
    if (!fixedRegion) {
      return;
    }

    const currentRegion = readValue(form, fieldMap, 'region');
    if (normalize(currentRegion) !== normalize(getRegionLabel(fixedRegion))) {
      updateAddressFields({
        province: FIXED_LOCATION.province,
        region: getRegionLabel(fixedRegion),
      });
    }
  }, [fieldMap, fixedRegion, form, updateAddressFields]);

  useEffect(() => {
    if (!fixedProvince) {
      return;
    }

    const currentProvince = readValue(form, fieldMap, 'province');
    if (normalize(currentProvince) !== normalize(fixedProvince.name)) {
      updateAddressFields({
        barangay: '',
        city: '',
        province: fixedProvince.name,
      });
    }
  }, [fieldMap, fixedProvince, form, updateAddressFields]);

  useEffect(() => {
    if (!fixedCity) {
      return;
    }

    const currentCity = readValue(form, fieldMap, 'city');
    if (!matchesAnyAlias(currentCity, FIXED_LOCATION.cityAliases)) {
      updateAddressFields({
        barangay: '',
        city: fixedCity.name || FIXED_LOCATION.cityCanonical,
      });
    }
  }, [fieldMap, fixedCity, form, updateAddressFields]);

  function handleStreetChange(event) {
    updateAddressFields({ street: event.target.value });
  }

  function handleCoordinateChange(event) {
    const addressKey = Object.entries(fieldMap).find(([, fieldName]) => fieldName === event.target.name)?.[0];

    if (!addressKey) {
      return;
    }

    updateAddressFields({ [addressKey]: event.target.value });
  }

  function handleRegionChange(event) {
    const nextRegion = regions.find((region) => region.code === event.target.value);

    setUseProfileAddress(false);
    updateAddressFields({
      barangay: '',
      city: '',
      province: '',
      region: nextRegion ? getRegionLabel(nextRegion) : '',
    });
  }

  function handleProvinceChange(event) {
    const nextProvince = provinces.find((province) => province.code === event.target.value);

    setUseProfileAddress(false);
    updateAddressFields({
      barangay: '',
      city: '',
      province: nextProvince ? nextProvince.name : '',
    });
  }

  function handleCityChange(event) {
    const nextCity = cities.find((city) => city.code === event.target.value);

    setUseProfileAddress(false);
    updateAddressFields({
      barangay: '',
      city: nextCity ? nextCity.name : '',
    });
  }

  function handleBarangayChange(event) {
    if (event.target.value === '__saved_barangay__') {
      return;
    }

    const nextBarangay = barangays.find((barangay) => barangay.code === event.target.value);

    setUseProfileAddress(false);
    updateAddressFields({
      barangay: nextBarangay ? nextBarangay.name : '',
    });
  }

  async function applyGeocodedResult(result, successMessage) {
    if (!isBaliwagLocation(result)) {
      throw new Error('Only addresses within Baliwag/Baliuag, Bulacan are allowed.');
    }

    const nextAddress = extractAddressFields(result);

    updateAddressFields({
      ...nextAddress,
      city: FIXED_LOCATION.cityCanonical,
      country: nextAddress.country || 'Philippines',
      province: FIXED_LOCATION.province,
      region: FIXED_LOCATION.regionCanonical,
    });
    setLocationMessage(successMessage);
    setLocationTone('success');
  }

  async function handleSearchPlace() {
    const query = sanitizeText(locationSearch);

    if (!query) {
      setLocationMessage('Enter a Philippine place to search on the map.');
      setLocationTone('warning');
      return;
    }

    setLocationBusy('search');
    setLocationMessage('');

    try {
      const result = await geocodePhilippineAddress(query);
      await applyGeocodedResult(result, 'Location search updated the pickup map and address fields.');
    } catch (locationError) {
      setLocationMessage(locationError.message);
      setLocationTone('danger');
    } finally {
      setLocationBusy('');
    }
  }

  async function handleUseProfileAddressChange(event) {
    const checked = event.target.checked;
    setUseProfileAddress(checked);

    if (!checked || !profileSource) {
      return;
    }

    const profileAddress = {
      barangay: sanitizeText(profileSource.barangay),
      city: sanitizeText(profileSource.city),
      country: sanitizeText(profileSource.country) || 'Philippines',
      latitude:
        profileSource.latitude === null || profileSource.latitude === undefined || profileSource.latitude === ''
          ? ''
          : String(profileSource.latitude),
      longitude:
        profileSource.longitude === null || profileSource.longitude === undefined || profileSource.longitude === ''
          ? ''
          : String(profileSource.longitude),
      province: sanitizeText(profileSource.province),
      region: sanitizeText(profileSource.region),
      street: sanitizeText(profileSource.street),
    };

    updateAddressFields(profileAddress);
    setLocationMessage('Pickup address now matches your saved profile address.');
    setLocationTone('success');

    if (!profileAddress.latitude || !profileAddress.longitude) {
      try {
        setLocationBusy('profile');
        const result = await geocodePhilippineAddress(buildAddressQuery(profileAddress));
        await applyGeocodedResult(result, 'Pickup address now matches your saved profile address and the map was updated.');
      } catch (locationError) {
        setLocationMessage(locationError.message);
        setLocationTone('danger');
      } finally {
        setLocationBusy('');
      }
    }
  }

  function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      setLocationMessage('This browser does not support device location.');
      setLocationTone('warning');
      return;
    }

    setLocationBusy('device');
    setLocationMessage('');

    navigator.geolocation.getCurrentPosition(
      (position) => {
        updateAddressFields({
          latitude: Number(position.coords.latitude).toFixed(7),
          longitude: Number(position.coords.longitude).toFixed(7),
        });
        setLocationMessage('Device coordinates were added.');
        setLocationTone('success');
        setLocationBusy('');
      },
      (geoError) => {
        setLocationMessage(geoError.message || 'Unable to read the current device location.');
        setLocationTone('danger');
        setLocationBusy('');
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {showUseProfileAddress && profileSource ? (
        <label
          style={{
            alignItems: 'center',
            color: theme.colors.ink,
            display: 'inline-flex',
            fontSize: 14,
            fontWeight: 600,
            gap: 10,
          }}
        >
          <input checked={useProfileAddress} onChange={handleUseProfileAddressChange} type="checkbox" />
          {labels.useProfileAddress}
        </label>
      ) : null}

      <div className="form-grid" style={addressGridStyle}>
        <FormField label={labels.street} required={requiredFieldSet.has('street')}>
          <Input name={fieldMap.street} onChange={handleStreetChange} value={readValue(form, fieldMap, 'street')} />
        </FormField>

        <FormField label={labels.region} required={requiredFieldSet.has('region')}>
          <select disabled={loadingRegions || !fixedRegion} onChange={handleRegionChange} style={selectStyle} value={fixedRegion?.code || ''}>
            <option value="">{loadingRegions ? 'Loading regions...' : 'Select region'}</option>
            {(fixedRegion ? [fixedRegion] : []).map((region) => (
              <option key={region.code} value={region.code}>
                {getRegionLabel(region)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={labels.province} required={requiredFieldSet.has('province')}>
          <select
            disabled={loadingProvinces || !fixedProvince}
            onChange={handleProvinceChange}
            style={selectStyle}
            value={fixedProvince?.code || ''}
          >
            <option value="">{loadingProvinces ? 'Loading provinces...' : 'Select province'}</option>
            {(fixedProvince ? [fixedProvince] : []).map((province) => (
              <option key={province.code} value={province.code}>
                {province.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label={labels.city} required={requiredFieldSet.has('city')}>
          <select
            disabled={loadingCities || !fixedCity}
            onChange={handleCityChange}
            style={selectStyle}
            value={fixedCity?.code || ''}
          >
            <option value="">{loadingCities ? 'Loading cities...' : 'Select city / municipality'}</option>
            {(fixedCity ? [fixedCity] : []).map((city) => (
              <option key={city.code} value={city.code}>
                {city.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={labels.barangay} required={requiredFieldSet.has('barangay')}>
          <SearchableSelect
            ariaLabel={labels.barangay}
            disabled={!selectedCity || loadingBarangays}
            emptyMessage="No barangay matches your search"
            onChange={(value) => handleBarangayChange({ target: { value } })}
            options={barangayOptions}
            placeholder={!selectedCity ? 'Select city first' : loadingBarangays ? 'Loading barangays...' : 'Select barangay'}
            searchPlaceholder="Search barangay"
            value={selectedBarangay?.code || (savedBarangay ? '__saved_barangay__' : '')}
          />
        </FormField>

        <FormField label={labels.country} required={requiredFieldSet.has('country')}>
          <Input name={fieldMap.country} readOnly value={readValue(form, fieldMap, 'country') || 'Philippines'} />
        </FormField>
      </div>

      <div
        className={flatMap ? 'address-map-section address-map-section-flat' : 'address-map-section'}
        style={{
          background: flatMap ? 'transparent' : alpha(theme.colors.panel, 0.76),
          border: flatMap ? 0 : `1px solid ${alpha(theme.colors.ink, 0.08)}`,
          borderRadius: flatMap ? 0 : 22,
          display: 'grid',
          gap: 16,
          padding: flatMap ? 0 : 18,
        }}
      >
        <div style={{ display: 'grid', gap: 6 }}>
          <strong
            style={{
              color: theme.colors.ink,
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            {labels.mapTitle}
          </strong>
          <span style={{ color: theme.colors.slate, fontSize: 13, lineHeight: 1.6 }}>{labels.mapDescription}</span>
        </div>

        <div className="form-grid" style={{ alignItems: 'start', display: 'grid', gap: 16, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div className="form-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
              <FormField label={labels.search} required={requiredFieldSet.has('search')}>
                <Input onChange={(event) => setLocationSearch(event.target.value)} placeholder={labels.searchPlaceholder} value={locationSearch} />
              </FormField>

              <div style={{ alignItems: 'end', display: 'flex' }}>
                <Button disabled={locationBusy === 'search'} onClick={handleSearchPlace} type="button" variant="secondary">
                  {locationBusy === 'search' ? 'Searching...' : 'Search place'}
                </Button>
              </div>
            </div>

            {showCoordinates ? (
              <div className="form-grid" style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                <FormField label="Latitude" required={requiredFieldSet.has('latitude')}>
                  <Input
                    name={fieldMap.latitude}
                    onChange={handleCoordinateChange}
                    placeholder="14.5995124"
                    value={readValue(form, fieldMap, 'latitude')}
                  />
                </FormField>

                <FormField label="Longitude" required={requiredFieldSet.has('longitude')}>
                  <Input
                    name={fieldMap.longitude}
                    onChange={handleCoordinateChange}
                    placeholder="120.9842195"
                    value={readValue(form, fieldMap, 'longitude')}
                  />
                </FormField>
              </div>
            ) : null}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <Button disabled={locationBusy === 'device'} onClick={handleUseCurrentLocation} type="button" variant="ghost">
                {locationBusy === 'device' ? 'Locating device...' : 'Use current location'}
              </Button>
            </div>

            {locationMessage ? <StatusMessage tone={locationTone}>{locationMessage}</StatusMessage> : null}
          </div>

          <div
            style={{
              background: alpha(theme.colors.panel, 0.86),
              border: `1px solid ${alpha(theme.colors.ink, 0.08)}`,
              borderRadius: 20,
              minHeight: 220,
              overflow: 'hidden',
            }}
          >
            {mapUrl ? (
              <iframe src={mapUrl} style={{ border: 0, display: 'block', height: 220, width: '100%' }} title={`${labels.mapTitle} preview`} />
            ) : (
              <div
                style={{
                  alignItems: 'center',
                  color: theme.colors.slate,
                  display: 'flex',
                  height: '100%',
                  justifyContent: 'center',
                  lineHeight: 1.6,
                  padding: 18,
                  textAlign: 'center',
                }}
              >
                Set the address, search a place, or use the device location to preview the map pin.
              </div>
            )}
          </div>
        </div>
      </div>

      {addressError ? <StatusMessage tone="warning">{addressError}</StatusMessage> : null}
    </div>
  );
}
