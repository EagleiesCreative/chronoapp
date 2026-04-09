cmake_minimum_required(VERSION 3.16)
project(sony_bridge LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---------------------------------------------------------------------------
# Sony CrSDK paths — adjust if your SDK is in a different location
# ---------------------------------------------------------------------------
set(CRSDK_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../libs/CrSDK"
    CACHE PATH "Path to the Sony Camera Remote SDK")

# Check if CrSDK is available
if(NOT EXISTS "${CRSDK_DIR}/include")
    message(WARNING "Sony CrSDK not found at ${CRSDK_DIR}")
    message(WARNING "Download from: https://support.d-imaging.sony.co.jp/app/sdk/en/index.html")
    message(WARNING "Place SDK files in: ${CRSDK_DIR}/include/ and ${CRSDK_DIR}/lib/")
    return()
endif()

# ---------------------------------------------------------------------------
# Bridge shared library
# ---------------------------------------------------------------------------
add_library(sony_bridge SHARED
    sony_bridge.cpp
)

target_include_directories(sony_bridge PRIVATE
    "${CRSDK_DIR}/include"
)

# Link against Sony CrSDK core library
if(APPLE)
    target_link_directories(sony_bridge PRIVATE "${CRSDK_DIR}/lib")
    target_link_libraries(sony_bridge PRIVATE Cr_Core)

    # Set rpath so the bridge can find libCr_Core.dylib at runtime
    set_target_properties(sony_bridge PROPERTIES
        INSTALL_RPATH "@loader_path"
        BUILD_WITH_INSTALL_RPATH TRUE
        MACOSX_RPATH TRUE
    )
elseif(WIN32)
    target_link_directories(sony_bridge PRIVATE "${CRSDK_DIR}/lib")
    target_link_libraries(sony_bridge PRIVATE Cr_Core)
endif()

# Output to the Tauri libs directory
set_target_properties(sony_bridge PROPERTIES
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../libs"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/../libs"
)

message(STATUS "Sony Bridge: CrSDK dir = ${CRSDK_DIR}")
message(STATUS "Sony Bridge: Output dir = ${CMAKE_CURRENT_SOURCE_DIR}/../libs")
