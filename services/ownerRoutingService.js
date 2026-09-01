'use strict';

class RoutingConfigurationError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'RoutingConfigurationError';
    this.code = code;
  }
}

function routingConfig(env = process.env) {
  const apiKey = String(env.GOOGLE_MAPS_API_KEY || '').trim();
  const origin = String(env.ELANKAV_LOGISTICS_ORIGIN || '').trim();
  if (!apiKey) throw new RoutingConfigurationError('GOOGLE_MAPS_API_KEY_REQUIRED', 'No está configurado el servicio de rutas para calcular kilómetros reales.');
  if (!origin) throw new RoutingConfigurationError('ELANKAV_LOGISTICS_ORIGIN_REQUIRED', 'No está configurado el punto de salida logístico de ELANKAV.');
  return { apiKey, origin };
}

function waypoint(value) {
  if (value && typeof value === 'object' && Number.isFinite(Number(value.latitude)) && Number.isFinite(Number(value.longitude))) {
    return {
      location: {
        latLng: {
          latitude: Number(value.latitude),
          longitude: Number(value.longitude)
        }
      }
    };
  }
  const address = String(value || '').trim();
  if (!address) throw new RoutingConfigurationError('ROUTING_DESTINATION_REQUIRED', 'Falta la ubicación de destino.');
  return { address };
}

async function computeRoadRoute(destination, env = process.env) {
  const { apiKey, origin } = routingConfig(env);
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'
    },
    body: JSON.stringify({
      origin: waypoint(origin),
      destination: waypoint(destination),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      computeAlternativeRoutes: false,
      units: 'METRIC'
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('ROUTING_PROVIDER_FAILED');
    error.code = 'ROUTING_PROVIDER_FAILED';
    error.statusCode = response.status;
    throw error;
  }
  const route = Array.isArray(payload.routes) ? payload.routes[0] : null;
  const distanceMeters = Number(route?.distanceMeters);
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    const error = new Error('ROUTING_DISTANCE_UNAVAILABLE');
    error.code = 'ROUTING_DISTANCE_UNAVAILABLE';
    throw error;
  }
  return Object.freeze({
    origin,
    distanceMeters,
    oneWayKm: Number((distanceMeters / 1000).toFixed(2)),
    duration: route?.duration || null,
    provider: 'GOOGLE_ROUTES'
  });
}

module.exports = {
  RoutingConfigurationError,
  computeRoadRoute,
  routingConfig,
  waypoint
};
