Noicee. Everything looks way better now, Next there are some fixes in terms of math
  and estimation. Also Remember that G stands for GPU and R stands for RPC and HC stands
  for CPU(HOST). RC stands for RPC CPU.

  1. Okay there is this logic, So I loaded a model with 16 layers, I have three devices
  G0, G1, R0. (G stands for GPU and R stands for RPC). So When I assign 8L to G0, Then
  5L to G1 and 2L to R0. 1L is going to the CPU, So the estimated usage is a number lets
  keep it there. So when you reduce a layer for eg I am reducing G1 layers from 5 to 4
  so that goes to the Host CPU right so CPU goes from 1L to 2L but the Host Ram Usage
  always stays 0.40GB does not go up instead G0 and R0 goes up in VRAM usage but
  technically nothing changed in them.

  2. Also We have to improve the UI even more to let know if a model that they are
  loading including context will be loaded on thier system or not. So I was loading the
  llama 3.2 1B-Instruct-Q8_0 model on the system with two Gs. So 16Ls total 8L on G0 and
  8L on G1 with ctx of 2048. Total footprint in 1.88GB. It loads I check the before and
  after VRAM usage is almost correct a little +- does not matter. What I wanna make
  better is when I increased CTX to 90K and still with same layer split the total
  footprint showed like 12.62GB VRAM and each Gs gets 6.11GB both G0 and G1. This means
  it is well inside the total VRAM that is combining both Gs gets around 15.9GB VRAM
  technically with active usage a little less but still 12.62 is easily gonna fit both
  and 6.11 is also gonna fit both. But the model does not load. Shows the parameters was
  unable to fit. So the estimation was wrong or what happened.

  3. This is something similar to