<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { Button } from '$lib/components/ui/button/index.ts';
  import * as Card from '$lib/components/ui/card/index.ts';
  import { Input } from '$lib/components/ui/input/index.ts';
  import { Label } from '$lib/components/ui/label/index.ts';
  import { session, type SignInOutcome } from '$lib/session/index.ts';

  const MESSAGES: Record<Exclude<SignInOutcome, 'signed-in'>, string> = {
    'invalid-credentials': 'El email o la contraseña no son correctos.',
    'too-many-attempts': 'Demasiados intentos. Probá de nuevo en unos minutos.',
    unavailable: 'No se pudo iniciar sesión. Probá de nuevo.',
  };

  let email = $state('');
  let password = $state('');
  let pending = $state(false);
  let message = $state<string | undefined>();

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    pending = true;
    const outcome = await session.signIn(email, password);
    pending = false;
    if (outcome === 'signed-in') {
      password = '';
      await goto(resolve('/'));
    } else {
      message = MESSAGES[outcome];
    }
  }
</script>

<main class="flex min-h-svh items-center justify-center p-6">
  <Card.Root class="w-full max-w-sm">
    <Card.Header>
      <Card.Title>Iniciar sesión</Card.Title>
    </Card.Header>
    <Card.Content>
      <form class="grid gap-4" onsubmit={submit}>
        <div class="grid gap-2">
          <Label for="email">Email</Label>
          <Input id="email" type="email" autocomplete="username" required bind:value={email} />
        </div>
        <div class="grid gap-2">
          <Label for="password">Contraseña</Label>
          <Input
            id="password"
            type="password"
            autocomplete="current-password"
            required
            bind:value={password}
          />
        </div>
        {#if message}
          <p class="text-sm text-destructive" role="alert">{message}</p>
        {/if}
        <Button type="submit" disabled={pending}>Entrar</Button>
      </form>
    </Card.Content>
  </Card.Root>
</main>
