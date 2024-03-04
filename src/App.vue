<script setup>
import HelloWorld from './components/HelloWorld.vue'

import { onMounted } from "vue"
import * as Scratch from '../src/components/scratch/scratch.js'

onMounted(() => {

  Scratch.StartDash()
})

</script>

<template>
  <HelloWorld msg="Vite + Vue" />
</template>

<style>
#app {
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  position: absolute;
}
</style>
