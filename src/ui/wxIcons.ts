/** 16px line icons for the weather (stroke = currentColor): the HUD row, the race set-up's sky picker */
import type { WeatherKind } from '../world/Weather.ts';

export const WX_ICON: Record<WeatherKind, string> = {
  clear: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3"/>',
  cloudy: '<path d="M6 3.2a2.6 2.6 0 0 1 4.3 1.2"/><path d="M4.5 13h7a2.6 2.6 0 0 0 .3-5.2 3.6 3.6 0 0 0-6.9-.6A2.9 2.9 0 0 0 4.5 13z"/>',
  overcast: '<path d="M4 12.5h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 12.5z"/>',
  drizzle: '<path d="M4 9.5h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9.5z"/><path d="M6 12v1M10 12v1"/>',
  rain: '<path d="M4 9.5h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9.5z"/><path d="M5 11.5l-.8 2.5M8 11.5l-.8 2.5M11 11.5l-.8 2.5"/>',
  storm: '<path d="M4 9.5h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9.5z"/><path d="M5 11.5l-.8 2.5M8 11.5l-.8 2.5M11 11.5l-.8 2.5"/><path d="M6.5 11l-.6 1.6M9.5 11l-.6 1.6"/>',
  thunderstorm: '<path d="M4 9.5h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9.5z"/><path d="M8.6 10.5 6.8 13h2.4l-1.6 2.5"/>',
  haze: '<circle cx="8" cy="6.5" r="2.6"/><path d="M2 11h12M3.5 13.5h9"/>',
  fog: '<path d="M2 5.5h12M3 8h10M2 10.5h12M4 13h8"/>',
  mist: '<circle cx="8" cy="5.5" r="2.4"/><path d="M2 10h12M3.5 12.5h9"/>',
  windy: '<path d="M2 6h8.5a2 2 0 1 0-2-2M2 9.5h11a2 2 0 1 1-2 2M2 13h6"/>',
  drying: '<circle cx="8" cy="6" r="2.8"/><path d="M8 1v1.2M3 6h1.2M11.8 6H13M4.5 2.5l.8.8M11.5 2.5l-.8.8"/><path d="M2.5 12.5c1.5-1 3-1 4.5 0s3 1 4.5 0"/>',
  sunshower: '<circle cx="5.5" cy="5" r="2.2"/><path d="M5.5 1v.9M1.5 5h.9M2.7 2.2l.6.6"/><path d="M7.5 10.5h5a2 2 0 0 0 .2-4 2.8 2.8 0 0 0-5.3-.3A2.2 2.2 0 0 0 7.5 10.5z"/><path d="M9 12.3l-.5 1.7M12 12.3l-.5 1.7"/>',
  heatwave: '<circle cx="8" cy="7" r="3.2"/><path d="M8 1v1.4M3 7H1.6M14.4 7H13M3.8 2.8l1 1M12.2 2.8l-1 1"/><path d="M3 12.5c1-.8 2-.8 3 0s2 .8 3 0 2-.8 3 0"/><path d="M4 14.8c1-.8 2-.8 3 0s2 .8 3 0"/>',
  sandstorm: '<path d="M1.5 5h7.5a1.8 1.8 0 1 0-1.8-1.8M1.5 8.5h10a1.8 1.8 0 1 1-1.8 1.8M1.5 12h5"/><circle cx="12.6" cy="5.6" r=".55"/><circle cx="9.6" cy="13.4" r=".55"/><circle cx="13.6" cy="13" r=".55"/>',
  frost: '<path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5"/><path d="M6.4 2.6 8 4.1l1.6-1.5M6.4 13.4 8 11.9l1.6 1.5"/>',
  hail: '<path d="M4 9h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9z"/><circle cx="5.2" cy="12" r=".9"/><circle cx="8.4" cy="13.6" r=".9"/><circle cx="11.2" cy="11.8" r=".9"/>',
  sleet: '<path d="M4 9h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9z"/><path d="M5 11l-.7 2.4M11 11l-.7 2.4"/><path d="M8 11.2v3M6.7 12.7h2.6"/>',
  flurries: '<path d="M4 9h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9z"/><path d="M6 11.2v2.6M4.7 12.5h2.6"/>',
  snow: '<path d="M4 9h7.8a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.3-.7A3.1 3.1 0 0 0 4 9z"/><path d="M5 11.2v2.6M3.7 12.5h2.6M11 11.2v2.6M9.7 12.5h2.6"/><circle cx="8" cy="14" r=".5"/>',
  blizzard: '<path d="M1.5 4.5h8a1.8 1.8 0 1 0-1.8-1.8M1.5 8h11a1.8 1.8 0 1 1-1.8 1.8"/><path d="M4 11v3.6M2.2 12.8h3.6M10 12v2.6M8.7 13.3h2.6"/>',
};

/** the choices that aren't a sky of their own */
export const WX_CHOICE_ICON = {
  random: '<rect x="2.5" y="2.5" width="11" height="11" rx="2.2"/><circle cx="5.6" cy="5.6" r=".8"/><circle cx="10.4" cy="10.4" r=".8"/><circle cx="8" cy="8" r=".8"/><circle cx="10.4" cy="5.6" r=".8"/><circle cx="5.6" cy="10.4" r=".8"/>',
  changeable: '<circle cx="4.6" cy="5" r="2"/><path d="M4.6 1.6v.6M1.2 5h.6M2.2 2.6l.4.4"/><path d="M7.5 12.8h4.6a1.9 1.9 0 0 0 .2-3.8 2.6 2.6 0 0 0-5-.3 2 2 0 0 0 .2 4.1z"/><path d="M8 4.5h3.5l-1.2-1.2M11.5 4.5l-1.2 1.2"/>',
};
