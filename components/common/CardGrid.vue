<template>
  <!-- Equal-height 2-column card grid. Grid rows stretch same-row cells to the
       tallest card (so MiniCard's h-full resolves to the row, not the whole
       container — which flex-wrap could not do). The ONE source of the
       MiniCard list layout; extra classes (padding/scroll/margins) merge via
       fallthrough. `full` MiniCards span both columns (col-span-2). -->
  <div class="grid grid-cols-2 gap-1.5 items-stretch">
    <slot />
  </div>
</template>
