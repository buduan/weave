<script setup lang="ts">
import { definePageMeta } from '#imports';

definePageMeta({
  layout: 'dashboard',
});
</script>

<template>
  <div class="space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <header
      class="grid gap-6 border-b border-accented pb-7
        md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
    >
      <div>
        <div class="flex flex-wrap items-center gap-3">
          <UBadge
            label="Layout preview"
            color="primary"
            variant="subtle"
            size="sm"
          />
          <code class="text-xs font-semibold text-muted">
            /dashboard
          </code>
        </div>
        <h1 class="mt-4 text-3xl font-bold tracking-[-0.035em] text-highlighted sm:text-4xl">
          Dashboard layout playground
        </h1>
        <p class="mt-3 max-w-2xl text-base leading-7 text-muted">
          A stable surface for checking navigation, spacing, responsive behavior,
          and page composition before real dashboard features are added.
        </p>
      </div>

      <UButton
        label="Back to start"
        icon="i-solar-arrow-left-up-bold-duotone"
        to="/"
        color="neutral"
        variant="outline"
        class="justify-self-start active:translate-y-px md:justify-self-end"
      />
    </header>

    <section
      class="grid items-start gap-6
        xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.65fr)]"
      aria-label="Dashboard layout debug areas"
    >
      <UCard
        class="overflow-hidden rounded-3xl border-default bg-default shadow-sm"
        :ui="{ body: 'p-0 sm:p-0' }"
      >
        <template #header>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-sm font-bold text-highlighted">
                Primary content area
              </p>
              <p class="mt-1 text-xs text-muted">
                Responsive width and vertical rhythm
              </p>
            </div>
            <UBadge
              label="Main slot"
              color="neutral"
              variant="outline"
              size="sm"
            />
          </div>
        </template>

        <div class="grid min-h-120 place-items-center bg-muted p-6 sm:p-10">
          <div class="max-w-md text-center">
            <span
              class="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10
                text-primary ring-1 ring-primary/20"
            >
              <UIcon
                name="i-solar-widget-4-bold-duotone"
                class="size-6"
              />
            </span>
            <p class="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-primary">
              Content slot
            </p>
            <h2 class="mt-2 text-2xl font-bold tracking-tight text-highlighted">
              Feature pages render here
            </h2>
            <p class="mt-3 text-sm leading-6 text-muted">
              Replace this fixture with real page content while keeping navigation,
              Workspace context, and user controls in the shared layout.
            </p>
          </div>
        </div>
      </UCard>

      <aside
        class="space-y-6"
        aria-label="Layout diagnostics"
      >
        <UCard
          class="rounded-3xl border-default bg-default shadow-sm"
        >
          <template #header>
            <div class="flex items-center gap-3">
              <span class="size-2 rounded-full bg-primary motion-safe:animate-pulse" />
              <h2 class="text-sm font-bold text-highlighted">
                Debug checklist
              </h2>
            </div>
          </template>

          <ul class="space-y-4">
            <li class="flex gap-3 text-sm leading-6 text-muted">
              <UIcon
                name="i-solar-check-circle-bold-duotone"
                class="mt-1 size-4 shrink-0 text-primary"
              />
              <span>Desktop sidebar stays fixed while content scrolls</span>
            </li>
            <li class="flex gap-3 text-sm leading-6 text-muted">
              <UIcon
                name="i-solar-check-circle-bold-duotone"
                class="mt-1 size-4 shrink-0 text-primary"
              />
              <span>Workspace switcher opens inside the sidebar</span>
            </li>
            <li class="flex gap-3 text-sm leading-6 text-muted">
              <UIcon
                name="i-solar-check-circle-bold-duotone"
                class="mt-1 size-4 shrink-0 text-primary"
              />
              <span>Navigation collapses into a mobile slideover</span>
            </li>
            <li class="flex gap-3 text-sm leading-6 text-muted">
              <UIcon
                name="i-solar-check-circle-bold-duotone"
                class="mt-1 size-4 shrink-0 text-primary"
              />
              <span>Content remains contained on wide displays</span>
            </li>
          </ul>
        </UCard>

        <UCard
          class="rounded-3xl border-default bg-default text-muted shadow-sm"
        >
          <template #header>
            <p class="text-sm font-bold text-highlighted">
              Layout constraints
            </p>
          </template>

          <dl class="divide-y divide-default text-sm">
            <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
              <dt class="text-muted">
                Sidebar
              </dt>
              <dd class="font-mono font-semibold text-toned">
                18rem
              </dd>
            </div>
            <div class="flex items-center justify-between gap-4 py-3">
              <dt class="text-muted">
                Content max
              </dt>
              <dd class="font-mono font-semibold text-toned">
                92rem
              </dd>
            </div>
            <div class="flex items-center justify-between gap-4 py-3 last:pb-0">
              <dt class="text-muted">
                Mobile menu
              </dt>
              <dd class="font-mono font-semibold text-toned">
                Slideover
              </dd>
            </div>
          </dl>
        </UCard>
      </aside>
    </section>

    <section
      class="rounded-3xl border border-default bg-default p-6 shadow-sm sm:p-8"
      aria-labelledby="scroll-test-title"
    >
      <div class="flex items-start gap-4">
        <span
          class="grid size-10 shrink-0 place-items-center rounded-xl bg-elevated
            text-muted"
        >
          <UIcon
            name="i-solar-sort-vertical-bold-duotone"
            class="size-5"
          />
        </span>
        <div>
          <h2
            id="scroll-test-title"
            class="text-sm font-bold text-highlighted"
          >
            Scroll boundary
          </h2>
          <p class="mt-1 max-w-2xl text-sm leading-6 text-muted">
            This final section makes the page tall enough to verify that the desktop
            sidebar remains fixed and the mobile header stays available while scrolling.
          </p>
        </div>
      </div>
      <div
        class="mt-6 h-40 rounded-xl border border-default bg-elevated"
        aria-hidden="true"
      />
    </section>
  </div>
</template>
