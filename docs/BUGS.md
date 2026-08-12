BUGS

1. When trying to compile llama.cpp (Vulkan) I get this error,  

`> git clone <https://github.com/ggerganov/llama.cpp.git> "/mnt/G/Onyx/engines/temp_src_llama.cpp (Vulkan)"
Cloning into '/mnt/G/Onyx/engines/temp_src_llama.cpp (Vulkan)'...
> cd "/mnt/G/Onyx/engines/temp_src_llama.cpp (Vulkan)" && cmake -B build -DGGML_RPC=ON -DBUILD_SHARED_LIBS=OFF -DGGML_VULKAN=ON
-- The C compiler identification is GNU 16.1.1
-- The CXX compiler identification is GNU 16.1.1
-- Detecting C compiler ABI info
-- Detecting C compiler ABI info - done
-- Check for working C compiler: /usr/bin/cc - skipped
-- Detecting C compile features
-- Detecting C compile features - done
-- Detecting CXX compiler ABI info
-- Detecting CXX compiler ABI info - done
-- Check for working CXX compiler: /usr/bin/c++ - skipped
-- Detecting CXX compile features
-- Detecting CXX compile features - done
CMAKE_BUILD_TYPE=Release
-- Found Git: /usr/bin/git (found version "2.55.0")
-- The ASM compiler identification is GNU
-- Found assembler: /usr/bin/cc
-- Performing Test CMAKE_HAVE_LIBC_PTHREAD
-- Performing Test CMAKE_HAVE_LIBC_PTHREAD - Success
-- Found Threads: TRUE
-- Warning: ccache not found - consider installing it for faster compilation or disable this warning with GGML_CCACHE=OFF
-- CMAKE_SYSTEM_PROCESSOR: x86_64
-- GGML_SYSTEM_ARCH: x86
-- Found OpenMP_C: -fopenmp (found version "5.2")
-- Found OpenMP_CXX: -fopenmp (found version "5.2")
-- Found OpenMP: TRUE (found version "5.2")
-- Including CPU backend
-- x86 detected
-- Adding CPU backend variant ggml-cpu: -march=native
-- Using RPC backend
--   RDMA transport disabled
-- Including RPC backend
CMake Error at /usr/share/cmake/Modules/FindPackageHandleStandardArgs.cmake:290 (message):
  Could NOT find Vulkan (missing: Vulkan_INCLUDE_DIR) (found version "")
Call Stack (most recent call first):
  /usr/share/cmake/Modules/FindPackageHandleStandardArgs.cmake:654 (_FPHSA_FAILURE_MESSAGE)
  /usr/share/cmake/Modules/FindVulkan.cmake:780 (find_package_handle_standard_args)
  ggml/src/ggml-vulkan/CMakeLists.txt:9 (find_package)
-- Configuring incomplete, errors occurred!
Error: Command failed: cd "/mnt/G/Onyx/engines/temp_src_llama.cpp (Vulkan)" && cmake -B build -DGGML_RPC=ON -DBUILD_SHARED_LIBS=OFF -DGGML_VULKAN=ON
    at genericNodeError (node:internal/errors:998:15)
    at wrappedFn (node:internal/errors:543:14)
    at checkExecSyncError (node:child_process:926:11)
    at execSync (node:child_process:998:15)
    at runCmd (/mnt/G/Onyx/scripts/engine_manager.js:30:2)
    at handleCompile (/mnt/G/Onyx/scripts/engine_manager.js:111:2)
    at main (/mnt/G/Onyx/scripts/engine_manager.js:176:40)
    at Object.<anonymous> (/mnt/G/Onyx/scripts/engine_manager.js:183:1)
    at Module._compile (node:internal/modules/cjs/loader:1944:14)
    at Object..js (node:internal/modules/cjs/loader:2084:10) {
  status: 1,
  signal: null,
  output: [ null, null, null ],
  pid: 8673,
  stdout: null,
  stderr: null
}`

2. Next in windows when i run the compile.bat I am getting this error
`PS C:\Users\Mughil\Desktop\Onyx> .\compile.bat 2> was unexpected at this time.`

3. In macOS there are two bugs which we needed to fix. 1. In macOS whent the app is running and under the dependencies tab, In it the homebrew installation goes out of the tab. macOS Dependencies Required

`Before compiling, please run the following command(s) in your terminal:

/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` 2. Next Problem in Macbook it shows Nvidia GPU: NO actually that dont want to be shown in the macOS and mac systems cuz there is no nvidia GPU obviously. It should be only shown in Linux and Windows.
