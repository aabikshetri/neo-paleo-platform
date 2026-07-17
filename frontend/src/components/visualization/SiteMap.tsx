import {
    MapContainer,
    TileLayer,
    CircleMarker,
    Popup,
    FeatureGroup,
  } from "react-leaflet";
  
  import "leaflet/dist/leaflet.css";
//   import "leaflet-draw/dist/leaflet.draw.css";
  
  export default function SiteMap({
    rows,
    onSiteSelect,
  }: any) {
  
    return (
      <MapContainer
        center={[45, -75]}
        zoom={4}
        style={{
          height: "650px",
          width: "100%",
        }}
      >
  
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
  
        {/* Rectangle Selection Tool */}
  
        <FeatureGroup>
  
          {/* <EditControl
            position="topright"
  
            draw={{
              rectangle: true,
  
              polygon: false,
              polyline: false,
              circle: false,
              marker: false,
              circlemarker: false,
            }}
  
            edit={{
              edit: false,
              remove: true,
            }}
  
            onCreated={(e: any) => {
  
              const bounds =
                e.layer.getBounds();
  
              const sw =
                bounds.getSouthWest();
  
              const ne =
                bounds.getNorthEast();
  
              onBoundsSelect({
  
                lat_min: sw.lat,
                lat_max: ne.lat,
  
                lon_min: sw.lng,
                lon_max: ne.lng,
  
              });
            }}
          /> */}
  
        </FeatureGroup>
  
        {/* Sample Locations */}
  
        {rows.map((row: any, i: number) => {
  
          if (
            row.latitude == null ||
            row.longitude == null
          ) {
            return null;
          }
  
          return (
  
            <CircleMarker
              key={i}
  
              center={[
                Number(row.latitude),
                Number(row.longitude),
              ]}
  
              radius={5}
  
              eventHandlers={{
                click: () =>
                  onSiteSelect(row),
              }}
            >
  
              <Popup>
  
                <strong>
                  {row.sitename}
                </strong>
  
                <br />
  
                Dataset:
                {" "}
                {row.datasetid}
  
                <br />
  
                pH:
                {" "}
                {row.pH}
  
                <br />
  
                Water Table:
                {" "}
                {row.water_table_depth}
  
                <br />
  
                Altitude:
                {" "}
                {row.altitude}
  
              </Popup>
  
            </CircleMarker>
  
          );
        })}
  
      </MapContainer>
    );
  }