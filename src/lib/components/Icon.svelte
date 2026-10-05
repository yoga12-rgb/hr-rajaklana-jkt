<script lang="ts">
  export let name = 'arrow-right';
  export let size = 20;
  export let stroke = 1.8;
  const paths: Record<string, string[]> = {
    'arrow-right': ['M5 12h14', 'm12 5 7 7-7 7'],
    'arrow-left': ['M19 12H5', 'm12 5-7 7 7 7'],
    chevron: ['m9 5 7 7-7 7'],
    plus: ['M12 5v14', 'M5 12h14'],
    close: ['m6 6 12 12', 'M6 18 18 6'],
    check: ['m5 12 4 4L19 6'],
    clock: ['M12 8v4l3 2'],
    calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z'],
    users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
    user: ['M20 21v-2a7 7 0 0 0-14 0v2'],
    building: ['M4 22V4h12v18', 'M16 10h4v12', 'M8 8h4', 'M8 12h4', 'M8 16h4', 'M2 22h20'],
    pin: ['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z'],
    camera: ['M14.5 4h-5L7 7H3v13h18V7h-4Z'],
    sun: ['M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2', 'm4.93 4.93 1.42 1.42', 'm17.65 17.65 1.42 1.42', 'm4.93 19.07 1.42-1.42', 'm17.65 6.35 1.42-1.42'],
    moon: ['M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z'],
    search: ['m21 21-4.35-4.35'],
    edit: ['m16 3 5 5-12 12-6 1 1-6Z', 'm13 6 5 5'],
    download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 16v5h14v-5'],
    shield: ['M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z', 'm8 12 3 3 5-5'],
    logout: ['M9 5H4v14h5', 'M9 12h12', 'm17 8 4 4-4 4'],
    alert: ['m12 3 10 18H2Z', 'M12 9v4', 'M12 17h.01'],
    file: ['M14 2H4v20h16V8Z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5'],
    home: ['m3 10 9-7 9 7v11h-6v-7H9v7H3Z'],
    chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
    filter: ['M3 4h18l-7 8v7l-4 2v-9Z'],
    briefcase: ['M8 6V3h8v3', 'M3 6h18v14H3Z', 'M3 12a24 24 0 0 0 18 0', 'M10 12h4v3h-4Z'],
    heart: ['M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z'],
    refresh: ['M20 7a8 8 0 1 0 1 8', 'M20 3v5h-5'],
    lock: ['M5 10h14v11H5Z', 'M8 10V6a4 4 0 0 1 8 0v4'],
    info: ['M12 11v6', 'M12 7h.01'],
    phone: ['M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .3 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z'],
    settings: ['M12 8v8', 'M8 12h8'],
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if ['clock', 'info', 'search', 'settings'].includes(name)}<circle cx={name === 'search' ? 10.5 : 12} cy={name === 'search' ? 10.5 : 12} r={name === 'search' ? 7.5 : 9}/>{/if}
  {#if name === 'users'}<circle cx="9" cy="7" r="4"/>{/if}
  {#if name === 'user'}<circle cx="13" cy="7" r="4"/>{/if}
  {#if ['pin', 'camera', 'sun'].includes(name)}<circle cx="12" cy={name === 'pin' ? 10 : 12} r={name === 'pin' ? 2.5 : name === 'sun' ? 4 : 3.5}/>{/if}
  {#each paths[name] || paths['arrow-right'] as d}<path {d}/>{/each}
</svg>
