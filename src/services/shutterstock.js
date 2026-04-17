import axios from "axios";

const BASE_URL = "https://api.shutterstock.com/v2/images/search";

export async function searchImages(query) {
  const auth = Buffer.from(
    `${process.env.SHUTTERSTOCK_CLIENT_ID}:${process.env.SHUTTERSTOCK_CLIENT_SECRET}`
  ).toString("base64");

  const response = await axios.get(BASE_URL, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
    params: {
      query,
      per_page: 5,
      orientation: "horizontal",
      width_from: 1440
    },
  });

  return response.data.data.map((img) => ({
    id: img.id,
    url: img.assets.preview_1000.url,
    description: img.description,
  }));
}