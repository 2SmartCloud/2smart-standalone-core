# 2smart-core

MQTT backend service.

## Multi-stage builds for arm32v7 and amd64:

1. Build images for AMD and ARM (you need to build an ARM image on the target platform):

    ```
    docker build --file Dockerfile -t <IMAGE>:latest-amd64  --build-arg ARCH=amd64/ .
    docker build --file Dockerfile.arm32 -t <IMAGE>:latest-arm32v7  --build-arg ARCH=arm32v7/ .
    ```

2. Push to registry:

    ```
    docker push <IMAGE>:latest-amd64
    docker push <IMAGE>:latest-arm32v7
    ```

3. Compile docker manifest:

    ```
    docker manifest create \
    <IMAGE>:latest \
        --amend <IMAGE>:latest-amd64 \
        --amend <IMAGE>:latest-arm32v7
    ```

4. Push manifest to registry:

    ```
    docker manifest push <IMAGE>:latest
    ```