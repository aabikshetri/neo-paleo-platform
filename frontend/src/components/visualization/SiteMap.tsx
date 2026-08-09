import { useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";

type SampleRow = {
  sampleid?: number;
  datasetid?: number;
  sitename?: string;
  latitude?: number | null;
  longitude?: number | null;
  pH?: number | null;
  water_table_depth?: number | null;
  altitude?: number | null;
};

function ClusteredMarkers({ rows, onSiteSelect }: {
  rows: SampleRow[];
  onSiteSelect: (row: SampleRow) => void;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });

  const clusters = useMemo(() => {
    const cellSize = zoom >= 9 ? 0 : Math.max(0.08, 80 / (2 ** zoom));
    const grouped = new Map<string, SampleRow[]>();
    rows.forEach((row) => {
      if (row.latitude == null || row.longitude == null) return;
      const key = cellSize === 0
        ? `sample:${row.sampleid}`
        : `${Math.floor(Number(row.latitude) / cellSize)}:${Math.floor(Number(row.longitude) / cellSize)}`;
      const samples = grouped.get(key);
      if (samples) samples.push(row);
      else grouped.set(key, [row]);
    });
    return Array.from(grouped.entries()).map(([key, samples]) => ({
      key,
      samples,
      latitude: samples.reduce((sum, row) => sum + Number(row.latitude), 0) / samples.length,
      longitude: samples.reduce((sum, row) => sum + Number(row.longitude), 0) / samples.length,
    }));
  }, [rows, zoom]);

  return clusters.map((cluster) => {
    const sample = cluster.samples[0];
    const isCluster = cluster.samples.length > 1;
    return (
      <CircleMarker
        key={cluster.key}
        center={[cluster.latitude, cluster.longitude]}
        radius={isCluster ? Math.min(22, 7 + Math.log2(cluster.samples.length) * 2) : 5}
        pathOptions={isCluster
          ? { color: "#0f766e", fillColor: "#14b8a6", fillOpacity: 0.72, weight: 2 }
          : undefined}
        eventHandlers={{
          click: () => {
            if (isCluster && zoom < 9) {
              map.setView([cluster.latitude, cluster.longitude], Math.min(9, zoom + 2));
            } else {
              onSiteSelect(sample);
            }
          },
        }}
      >
        <Popup>
          {isCluster ? (
            <><strong>{cluster.samples.length.toLocaleString()} samples</strong><br />Click to zoom in</>
          ) : (
            <>
              <strong>{sample.sitename}</strong><br />
              Dataset: {sample.datasetid}<br />
              pH: {sample.pH}<br />
              Water Table: {sample.water_table_depth}<br />
              Altitude: {sample.altitude}
            </>
          )}
        </Popup>
      </CircleMarker>
    );
  });
}

export default function SiteMap({ rows, onSiteSelect }: {
  rows: SampleRow[];
  onSiteSelect: (row: SampleRow) => void;
  onBoundsSelect?: (bounds: unknown) => void;
}) {
  return (
    <MapContainer
      center={[45, -75]}
      zoom={4}
      preferCanvas
      style={{ height: "650px", width: "100%" }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <ClusteredMarkers rows={rows} onSiteSelect={onSiteSelect} />
    </MapContainer>
  );
}
