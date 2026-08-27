import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, FormField, Input, StatusMessage } from './primitives';
import SearchableSelect from './SearchableSelect';
import { alpha, theme } from './theme';
import { buildAddressQuery, buildMapEmbedUrl, geocodePhilippineAddress, sanitizeText } from './profileFormUtils';
import './PhilippineAddressFields.css';

const PSGC_BASE_URL = 'https://psgc.gitlab.io/api';

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

const addressFieldKeys = Object.keys(defaultFieldMap);

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

function normalizePlaceName(value) {
  return normalize(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bsta\.?\b/g, 'santa')
    .replace(/\bsto\.?\b/g, 'santo')
    .replace(/\bpob\.?\b/g, 'poblacion')
    .replace(/^\s*(?:city|municipality|municipal district)\s+of\s+/g, '')
    .replace(/\s+(?:city|municipality|municipal district)\s*$/g, '')
    .replace(/\bbaliuag\b/g, 'baliwag')
    .replace(/[^a-z0-9]/g, '');
}

export function getRegionLabel(region) {
  if (!region) {
    return '';
  }

  const name = sanitizeText(region.name);
  const regionName = sanitizeText(region.regionName);
  return name && regionName && normalize(name) !== normalize(regionName)
    ? `${name} (${regionName})`
    : name || regionName;
}

function findByName(options, value, labelBuilder) {
  const normalizedValue = normalize(value);

  return options.find((option) => {
    const optionName = normalize(option.name);
    const optionLabel = normalize(labelBuilder ? labelBuilder(option) : option.name);
    return optionName === normalizedValue || optionLabel === normalizedValue;
  });
}

export function findCityMunicipalityByName(options, value) {
  const normalizedValue = normalizePlaceName(value);
  return options.find((option) => normalizePlaceName(option.name) === normalizedValue);
}

export function findRegionByName(options, value) {
  const normalizedValue = normalize(value);
  return options.find((region) => [region.name, region.regionName, getRegionLabel(region)]
    .some((candidate) => normalize(candidate) === normalizedValue));
}

function normalizeBarangayName(value) {
  return normalizePlaceName(normalize(value).replace(/\b(?:barangay|brgy)\.?\b/g, ' '));
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

export function mergeGeocodedAddressFields(currentAddress, geocodedAddress) {
  return addressFieldKeys.reduce((merged, key) => {
    const nextValue = geocodedAddress?.[key];
    const hasNextValue = nextValue !== null
      && nextValue !== undefined
      && String(nextValue).trim() !== '';

    merged[key] = hasNextValue ? nextValue : currentAddress?.[key] || '';
    return merged;
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
    if (!readValue(form, fieldMap, 'country')) {
      setForm((current) => ({
        ...current,
        [fieldMap.country]: 'Philippines',
      }));
    }
  }, [fieldMap.country, fieldMap, form, setForm]);

  const selectedRegion = useMemo(() => findRegionByName(regions, readValue(form, fieldMap, 'region')), [fieldMap, form, regions]);
  const selectedProvince = useMemo(() => findByName(provinces, readValue(form, fieldMap, 'province')), [fieldMap, form, provinces]);
  const selectedCity = useMemo(() => findCityMunicipalityByName(cities, readValue(form, fieldMap, 'city')), [cities, fieldMap, form]);
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
          updateAddressFields({ province: getRegionLabel(selectedRegion) });
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
  }, [selectedRegion, updateAddressFields]);

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
    const nextAddress = extractAddressFields(result);

    setForm((current) => {
      const currentAddress = addressFieldKeys.reduce((address, key) => {
        const fieldName = fieldMap[key];
        address[key] = fieldName ? current?.[fieldName] || '' : '';
        return address;
      }, {});
      const mergedAddress = mergeGeocodedAddressFields(currentAddress, {
        ...nextAddress,
        country: nextAddress.country || 'Philippines',
      });

      return {
        ...current,
        ...createMappedFields(fieldMap, mergedAddress),
      };
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
          <select disabled={loadingRegions} onChange={handleRegionChange} style={selectStyle} value={selectedRegion?.code || ''}>
            <option value="">{loadingRegions ? 'Loading regions...' : 'Select region'}</option>
            {regions.map((region) => (
              <option key={region.code} value={region.code}>
                {getRegionLabel(region)}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label={labels.province} required={requiredFieldSet.has('province')}>
          <select
            disabled={loadingProvinces || !selectedRegion || regionHasDirectCities}
            onChange={handleProvinceChange}
            style={selectStyle}
            value={selectedProvince?.code || ''}
          >
            <option value="">{loadingProvinces ? 'Loading provinces...' : 'Select province'}</option>
            {provinces.map((province) => (
              <option key={province.code} value={province.code}>
                {province.name}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label={labels.city} required={requiredFieldSet.has('city')}>
          <select
            disabled={loadingCities || !selectedRegion || (!regionHasDirectCities && !selectedProvince)}
            onChange={handleCityChange}
            style={selectStyle}
            value={selectedCity?.code || ''}
          >
            <option value="">{loadingCities ? 'Loading cities...' : 'Select city / municipality'}</option>
            {cities.map((city) => (
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
          background: flatMap ? 'transparent' : 'var(--ui-background-color, #ffffff)',
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
            <div className="address-map-search-row">
              <FormField label={labels.search} required={requiredFieldSet.has('search')}>
                <Input onChange={(event) => setLocationSearch(event.target.value)} placeholder={labels.searchPlaceholder} value={locationSearch} />
              </FormField>

              <div className="address-map-search-action">
                <Button disabled={locationBusy === 'search'} onClick={handleSearchPlace} type="button" variant="secondary">
                  {locationBusy === 'search' ? 'Searching...' : 'Search place'}
                </Button>
              </div>

              <div className="address-map-search-action">
                <Button disabled={locationBusy === 'device'} onClick={handleUseCurrentLocation} type="button" variant="ghost">
                  {locationBusy === 'device' ? 'Locating device...' : 'Use current location'}
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

            {locationMessage ? <StatusMessage tone={locationTone}>{locationMessage}</StatusMessage> : null}
          </div>

          <div
            style={{
              background: 'var(--ui-background-color, #ffffff)',
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
